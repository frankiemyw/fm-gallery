import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(ROOT_DIR, "site");
const BUNDLED_MEDIA_DIR = path.join(ROOT_DIR, "media");
const FALLBACK_MEDIA_DIR = path.join(ROOT_DIR, "media");
const FALLBACK_DATA_DIR = path.join(ROOT_DIR, "data");

function projectPath(value, fallback) {
  return value ? path.resolve(ROOT_DIR, value) : fallback;
}

let MEDIA_DIR = projectPath(process.env.MEDIA_DIR, FALLBACK_MEDIA_DIR);
let DATA_DIR = projectPath(process.env.DATA_DIR, FALLBACK_DATA_DIR);
let DB_FILE = projectPath(process.env.DB_FILE, path.join(DATA_DIR, "db.json"));
const PORT = Number(process.env.PORT || 4177);

const SESSION_COOKIE = "ai_gallery_session";
const SESSION_DAYS = 7;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".ogg", ".webm"]);
const POSTER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4v", "video/x-m4v"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".ogg", "video/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webm", "video/webm"],
  [".webp", "image/webp"]
]);

let bundledMediaSeeded = false;
let storageFallbackApplied = false;

const DEFAULT_DB = {
  artworks: [],
  comments: [],
  likes: [],
  messages: [],
  sessions: [],
  users: []
};

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(data));
}

function sendPlain(response, status, message, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers
  });
  response.end(message);
}

function mediaUrl(relativePath) {
  return `/media/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function titleFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || "Untitled";
}

function safeJoin(baseDir, requestPath) {
  const cleanPath = decodeURIComponent(requestPath).replace(/^[/\\]+/, "");
  const resolvedPath = path.resolve(baseDir, cleanPath);

  if (resolvedPath !== baseDir && !resolvedPath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("Path escapes base directory");
  }

  return resolvedPath;
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    createdAt: user.createdAt,
    email: user.email,
    name: user.name
  };
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(cookieHeader.split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const index = cookie.indexOf("=");
      const key = index === -1 ? cookie : cookie.slice(0, index);
      const value = index === -1 ? "" : cookie.slice(index + 1);
      return [key, decodeURIComponent(value)];
    }));
}

function sessionCookie(sessionId) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash).split(":");

  if (!salt || !hash) {
    return false;
  }

  const incomingHash = scryptSync(password, salt, 64);
  const savedHash = Buffer.from(hash, "hex");

  return savedHash.length === incomingHash.length && timingSafeEqual(savedHash, incomingHash);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function commentSummary(db, artworkId) {
  return db.comments.filter((comment) => comment.artworkId === artworkId).length;
}

function likeSummary(db, artworkId) {
  return db.likes.filter((like) => like.artworkId === artworkId).length;
}

function likedByUser(db, artworkId, user) {
  return Boolean(user && db.likes.some((like) => like.artworkId === artworkId && like.userId === user.id));
}

async function ensureStorage() {
  try {
    await ensureStorageDirectories();
  } catch (error) {
    if (!canUseFallbackStorage(error)) {
      throw error;
    }

    useFallbackStorage(error);
    await ensureStorageDirectories();
  }

  await seedBundledMedia();
}

async function ensureStorageDirectories() {
  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(path.join(MEDIA_DIR, "paintings"), { recursive: true }),
    fs.mkdir(path.join(MEDIA_DIR, "videos"), { recursive: true }),
    fs.mkdir(path.join(MEDIA_DIR, "posters"), { recursive: true })
  ]);
}

function canUseFallbackStorage(error) {
  if (storageFallbackApplied) {
    return false;
  }

  if (!["EACCES", "EROFS", "EPERM"].includes(error?.code)) {
    return false;
  }

  return path.resolve(DATA_DIR) !== path.resolve(FALLBACK_DATA_DIR) ||
    path.resolve(MEDIA_DIR) !== path.resolve(FALLBACK_MEDIA_DIR);
}

function useFallbackStorage(error) {
  storageFallbackApplied = true;
  MEDIA_DIR = FALLBACK_MEDIA_DIR;
  DATA_DIR = FALLBACK_DATA_DIR;
  DB_FILE = path.join(DATA_DIR, "db.json");
  console.warn(`Persistent storage is not writable (${error.code}). Falling back to local app storage.`);
}

async function copyMissingFiles(sourceDir, targetDir) {
  let entries = [];

  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }

  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyMissingFiles(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile() && !await pathExists(targetPath)) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function seedBundledMedia() {
  if (bundledMediaSeeded || path.resolve(MEDIA_DIR) === path.resolve(BUNDLED_MEDIA_DIR)) {
    bundledMediaSeeded = true;
    return;
  }

  bundledMediaSeeded = true;

  await Promise.all([
    copyMissingFiles(path.join(BUNDLED_MEDIA_DIR, "paintings"), path.join(MEDIA_DIR, "paintings")),
    copyMissingFiles(path.join(BUNDLED_MEDIA_DIR, "videos"), path.join(MEDIA_DIR, "videos")),
    copyMissingFiles(path.join(BUNDLED_MEDIA_DIR, "posters"), path.join(MEDIA_DIR, "posters"))
  ]);
}

async function loadDb() {
  await ensureStorage();

  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      artworks: Array.isArray(parsed.artworks) ? parsed.artworks : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      likes: Array.isArray(parsed.likes) ? parsed.likes : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      users: Array.isArray(parsed.users) ? parsed.users : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return structuredClone(DEFAULT_DB);
  }
}

async function saveDb(db) {
  await ensureStorage();
  const tempFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(db, null, 2));
  await fs.rename(tempFile, DB_FILE);
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > maxBytes) {
      throw new Error("Request is too large");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON_BYTES);

  if (!body.length) {
    return {};
  }

  return JSON.parse(body.toString("utf8"));
}

function parseContentDisposition(value = "") {
  const data = {};

  for (const segment of value.split(";")) {
    const [rawKey, ...rest] = segment.trim().split("=");
    const key = rawKey.trim().toLowerCase();
    const rawValue = rest.join("=").trim();

    if (!key || !rawValue) {
      continue;
    }

    data[key] = rawValue.replace(/^"|"$/g, "");
  }

  return data;
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerBreak = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = {};
  let position = body.indexOf(delimiter);

  while (position !== -1) {
    const nextPosition = body.indexOf(delimiter, position + delimiter.length);

    if (nextPosition === -1) {
      break;
    }

    let part = body.subarray(position + delimiter.length, nextPosition);
    position = nextPosition;

    if (part.subarray(0, 2).toString("utf8") === "--") {
      continue;
    }

    if (part.subarray(0, 2).toString("utf8") === "\r\n") {
      part = part.subarray(2);
    }

    if (part.subarray(-2).toString("utf8") === "\r\n") {
      part = part.subarray(0, -2);
    }

    const headerEnd = part.indexOf(headerBreak);

    if (headerEnd === -1) {
      continue;
    }

    const headers = Object.fromEntries(part.subarray(0, headerEnd).toString("utf8")
      .split("\r\n")
      .map((line) => {
        const index = line.indexOf(":");
        return index === -1 ? null : [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
      })
      .filter(Boolean));

    const disposition = parseContentDisposition(headers["content-disposition"]);
    const name = disposition.name;

    if (!name) {
      continue;
    }

    const content = part.subarray(headerEnd + headerBreak.length);

    if (disposition.filename) {
      files[name] = {
        contentType: headers["content-type"] || "application/octet-stream",
        data: content,
        filename: path.basename(disposition.filename)
      };
      continue;
    }

    fields[name] = content.toString("utf8").trim();
  }

  return { fields, files };
}

async function getRequestUser(request, db) {
  const cookies = parseCookies(request.headers.cookie || "");
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId) {
    return null;
  }

  const session = db.sessions.find((item) => item.id === sessionId);

  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }

  return db.users.find((user) => user.id === session.userId) || null;
}

function createSession(db, userId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = {
    id: randomBytes(32).toString("hex"),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    userId
  };

  db.sessions.push(session);
  return session;
}

async function pathExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function collectFiles(directory, extensions, prefix = "") {
  let entries = [];

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, extensions, relativePath));
      continue;
    }

    if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(relativePath);
    }
  }

  return files;
}

async function findVideoPoster(relativeVideoPath) {
  const parsedPath = path.parse(relativeVideoPath);
  const relativePosterBase = path.join(parsedPath.dir, parsedPath.name);

  for (const extension of POSTER_EXTENSIONS) {
    const relativePosterPath = `${relativePosterBase}${extension}`;
    const absolutePosterPath = path.join(MEDIA_DIR, "posters", relativePosterPath);

    if (await pathExists(absolutePosterPath)) {
      return mediaUrl(path.join("posters", relativePosterPath));
    }
  }

  return "";
}

async function uploadedArtwork(record, db, requestUser) {
  const owner = db.users.find((user) => user.id === record.ownerId);

  return {
    id: record.id,
    type: record.type,
    title: record.title,
    filename: record.filename,
    src: record.src,
    poster: record.poster || record.src,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    size: record.size,
    ownerId: record.ownerId,
    ownerName: owner?.name || "Unknown artist",
    commentCount: commentSummary(db, record.id),
    likeCount: likeSummary(db, record.id),
    likedByMe: likedByUser(db, record.id, requestUser),
    canEdit: Boolean(requestUser && requestUser.id === record.ownerId),
    canChat: Boolean(requestUser && record.ownerId && requestUser.id !== record.ownerId),
    source: "account"
  };
}

async function listGalleryItems(db, requestUser = null) {
  const uploadedItems = [];
  const uploadedSources = new Set();

  for (const record of db.artworks) {
    const absolutePath = safeJoin(MEDIA_DIR, record.storagePath || "");

    if (!await pathExists(absolutePath)) {
      continue;
    }

    uploadedSources.add(record.src);
    uploadedItems.push(await uploadedArtwork(record, db, requestUser));
  }

  const [paintingFiles, videoFiles] = await Promise.all([
    collectFiles(path.join(MEDIA_DIR, "paintings"), IMAGE_EXTENSIONS),
    collectFiles(path.join(MEDIA_DIR, "videos"), VIDEO_EXTENSIONS)
  ]);

  const paintings = await Promise.all(paintingFiles.map(async (relativePath) => {
    const sourcePath = path.join("paintings", relativePath);
    const src = mediaUrl(sourcePath);

    if (uploadedSources.has(src)) {
      return null;
    }

    const absolutePath = path.join(MEDIA_DIR, "paintings", relativePath);
    const stats = await fs.stat(absolutePath);
    const id = createHash("sha1").update(sourcePath).digest("hex").slice(0, 12);

    return {
      id,
      type: "painting",
      title: titleFromFilename(relativePath),
      filename: path.basename(relativePath),
      src,
      poster: src,
      createdAt: stats.mtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
      size: stats.size,
      ownerId: null,
      ownerName: "Studio Archive",
      commentCount: commentSummary(db, id),
      likeCount: likeSummary(db, id),
      likedByMe: likedByUser(db, id, requestUser),
      canEdit: false,
      canChat: false,
      source: "folder"
    };
  }));

  const videos = await Promise.all(videoFiles.map(async (relativePath) => {
    const sourcePath = path.join("videos", relativePath);
    const src = mediaUrl(sourcePath);

    if (uploadedSources.has(src)) {
      return null;
    }

    const absolutePath = path.join(MEDIA_DIR, "videos", relativePath);
    const stats = await fs.stat(absolutePath);
    const id = createHash("sha1").update(sourcePath).digest("hex").slice(0, 12);

    return {
      id,
      type: "video",
      title: titleFromFilename(relativePath),
      filename: path.basename(relativePath),
      src,
      poster: await findVideoPoster(relativePath),
      createdAt: stats.mtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
      size: stats.size,
      ownerId: null,
      ownerName: "Studio Archive",
      commentCount: commentSummary(db, id),
      likeCount: likeSummary(db, id),
      likedByMe: likedByUser(db, id, requestUser),
      canEdit: false,
      canChat: false,
      source: "folder"
    };
  }));

  return [...uploadedItems, ...paintings, ...videos]
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function serveFile(request, response, filePath) {
  let stats;

  try {
    stats = await fs.stat(filePath);
  } catch {
    sendPlain(response, 404, "Not found");
    return;
  }

  if (!stats.isFile()) {
    sendPlain(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES.get(extension) || "application/octet-stream";
  const range = request.headers.range;

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);

    if (!match) {
      sendPlain(response, 416, "Invalid range");
      return;
    }

    const start = match[1] === "" ? 0 : Number(match[1]);
    const end = match[2] === "" ? stats.size - 1 : Number(match[2]);

    if (start >= stats.size || end >= stats.size || start > end) {
      response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
      response.end();
      return;
    }

    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=60",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
      "Content-Type": contentType
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=60",
    "Content-Length": stats.size,
    "Content-Type": contentType
  });
  createReadStream(filePath).pipe(response);
}

async function requireUser(request) {
  const db = await loadDb();
  const user = await getRequestUser(request, db);

  if (!user) {
    return { db, user: null };
  }

  return { db, user };
}

function validateAuthFields({ email, name, password }, mode) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = normalizeName(name);
  const cleanPassword = String(password || "");

  if (!cleanEmail.includes("@") || cleanEmail.length > 120) {
    return { error: "Use a valid email address." };
  }

  if (mode === "signup" && (cleanName.length < 2 || cleanName.length > 60)) {
    return { error: "Use a name between 2 and 60 characters." };
  }

  if (cleanPassword.length < 6 || cleanPassword.length > 128) {
    return { error: "Use a password with at least 6 characters." };
  }

  return { email: cleanEmail, name: cleanName, password: cleanPassword };
}

async function handleSignup(request, response) {
  const data = await readJson(request);
  const fields = validateAuthFields(data, "signup");

  if (fields.error) {
    sendJson(response, 400, { error: fields.error });
    return;
  }

  const db = await loadDb();

  if (db.users.some((user) => user.email === fields.email)) {
    sendJson(response, 409, { error: "An account with this email already exists." });
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: randomBytes(12).toString("hex"),
    createdAt: now,
    email: fields.email,
    name: fields.name,
    passwordHash: hashPassword(fields.password)
  };

  db.users.push(user);
  const session = createSession(db, user.id);
  await saveDb(db);

  sendJson(response, 201, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(session.id) });
}

async function handleSignin(request, response) {
  const data = await readJson(request);
  const fields = validateAuthFields(data, "signin");

  if (fields.error) {
    sendJson(response, 400, { error: fields.error });
    return;
  }

  const db = await loadDb();
  const user = db.users.find((candidate) => candidate.email === fields.email);

  if (!user || !verifyPassword(fields.password, user.passwordHash)) {
    sendJson(response, 401, { error: "Email or password is incorrect." });
    return;
  }

  const session = createSession(db, user.id);
  await saveDb(db);

  sendJson(response, 200, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(session.id) });
}

async function handleSignout(request, response) {
  const cookies = parseCookies(request.headers.cookie || "");
  const sessionId = cookies[SESSION_COOKIE];
  const db = await loadDb();

  if (sessionId) {
    db.sessions = db.sessions.filter((session) => session.id !== sessionId);
    await saveDb(db);
  }

  sendJson(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
}

async function handleUpload(request, response) {
  const { db, user } = await requireUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to upload artwork." });
    return;
  }

  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/)?.[1]?.replace(/^"|"$/g, "");

  if (!boundary) {
    sendJson(response, 400, { error: "Upload form is missing file data." });
    return;
  }

  const body = await readBody(request, MAX_UPLOAD_BYTES);
  const { fields, files } = parseMultipart(body, boundary);
  const file = files.file;

  if (!file || !file.data.length) {
    sendJson(response, 400, { error: "Choose an image or video file." });
    return;
  }

  const extension = path.extname(file.filename).toLowerCase();
  const requestedType = fields.type === "video" ? "video" : "painting";
  const type = VIDEO_EXTENSIONS.has(extension) ? "video" : requestedType;
  const allowedExtensions = type === "video" ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS;

  if (!allowedExtensions.has(extension)) {
    sendJson(response, 400, { error: type === "video" ? "Use a supported video file." : "Use a supported image file." });
    return;
  }

  const folder = type === "video" ? "videos" : "paintings";
  const title = normalizeName(fields.title) || titleFromFilename(file.filename);
  const originalBase = slugify(path.basename(file.filename, extension)) || "ai-work";
  const storedName = `${Date.now()}-${randomBytes(4).toString("hex")}-${originalBase}${extension}`;
  const storagePath = path.join(folder, storedName);
  const absolutePath = path.join(MEDIA_DIR, storagePath);

  await fs.writeFile(absolutePath, file.data);

  const now = new Date().toISOString();
  const artwork = {
    id: randomBytes(12).toString("hex"),
    type,
    title: title.slice(0, 100),
    filename: file.filename,
    src: mediaUrl(storagePath),
    poster: type === "video" ? "" : mediaUrl(storagePath),
    storagePath,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    size: file.data.length
  };

  db.artworks.push(artwork);
  await saveDb(db);

  sendJson(response, 201, { artwork: await uploadedArtwork(artwork, db, user) });
}

async function handleArtworkUpdate(request, response, artworkId) {
  const { db, user } = await requireUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to edit artwork." });
    return;
  }

  const artwork = db.artworks.find((item) => item.id === artworkId);

  if (!artwork) {
    sendJson(response, 404, { error: "Artwork was not found." });
    return;
  }

  if (artwork.ownerId !== user.id) {
    sendJson(response, 403, { error: "Only the owner can update this artwork." });
    return;
  }

  const data = await readJson(request);
  const title = normalizeName(data.title);

  if (title.length < 1 || title.length > 100) {
    sendJson(response, 400, { error: "Use a title between 1 and 100 characters." });
    return;
  }

  artwork.title = title;
  artwork.updatedAt = new Date().toISOString();
  await saveDb(db);

  sendJson(response, 200, { artwork: await uploadedArtwork(artwork, db, user) });
}

async function handleArtworkDelete(request, response, artworkId) {
  const { db, user } = await requireUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to delete artwork." });
    return;
  }

  const artwork = db.artworks.find((item) => item.id === artworkId);

  if (!artwork) {
    sendJson(response, 404, { error: "Artwork was not found." });
    return;
  }

  if (artwork.ownerId !== user.id) {
    sendJson(response, 403, { error: "Only the owner can delete this artwork." });
    return;
  }

  const absolutePath = safeJoin(MEDIA_DIR, artwork.storagePath);
  await fs.rm(absolutePath, { force: true });
  db.artworks = db.artworks.filter((item) => item.id !== artworkId);
  db.comments = db.comments.filter((comment) => comment.artworkId !== artworkId);
  db.likes = db.likes.filter((like) => like.artworkId !== artworkId);
  await saveDb(db);

  sendJson(response, 200, { ok: true });
}

function publicComment(comment, db) {
  const author = db.users.find((user) => user.id === comment.userId);

  return {
    id: comment.id,
    artworkId: comment.artworkId,
    authorName: author?.name || "Gallery visitor",
    body: comment.body,
    createdAt: comment.createdAt
  };
}

async function artworkExists(db, artworkId) {
  if (db.artworks.some((item) => item.id === artworkId)) {
    return true;
  }

  const items = await listGalleryItems(db);
  return items.some((item) => item.id === artworkId);
}

async function handleComments(request, response, artworkId) {
  const db = await loadDb();

  if (!await artworkExists(db, artworkId)) {
    sendJson(response, 404, { error: "Artwork was not found." });
    return;
  }

  if (request.method === "GET") {
    const comments = db.comments
      .filter((comment) => comment.artworkId === artworkId)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .map((comment) => publicComment(comment, db));

    sendJson(response, 200, { comments });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const user = await getRequestUser(request, db);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to comment." });
    return;
  }

  const data = await readJson(request);
  const body = String(data.body || "").trim();

  if (body.length < 1 || body.length > 500) {
    sendJson(response, 400, { error: "Comments must be between 1 and 500 characters." });
    return;
  }

  const comment = {
    id: randomBytes(12).toString("hex"),
    artworkId,
    body,
    createdAt: new Date().toISOString(),
    userId: user.id
  };

  db.comments.push(comment);
  await saveDb(db);

  sendJson(response, 201, { comment: publicComment(comment, db) });
}

async function handleLikeToggle(request, response, artworkId) {
  const db = await loadDb();
  const user = await getRequestUser(request, db);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to like artwork." });
    return;
  }

  if (!await artworkExists(db, artworkId)) {
    sendJson(response, 404, { error: "Artwork was not found." });
    return;
  }

  const existingLike = db.likes.find((like) => like.artworkId === artworkId && like.userId === user.id);

  if (existingLike) {
    db.likes = db.likes.filter((like) => like.id !== existingLike.id);
  } else {
    db.likes.push({
      id: randomBytes(12).toString("hex"),
      artworkId,
      createdAt: new Date().toISOString(),
      userId: user.id
    });
  }

  await saveDb(db);

  sendJson(response, 200, {
    likedByMe: likedByUser(db, artworkId, user),
    likeCount: likeSummary(db, artworkId)
  });
}

function publicMessage(message, db, requestUser) {
  const fromUser = db.users.find((user) => user.id === message.fromUserId);
  const toUser = db.users.find((user) => user.id === message.toUserId);

  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    fromUserId: message.fromUserId,
    fromName: fromUser?.name || "Gallery member",
    isMine: Boolean(requestUser && requestUser.id === message.fromUserId),
    toUserId: message.toUserId,
    toName: toUser?.name || "Gallery member"
  };
}

function publicConversation(partner, messages, db, requestUser) {
  const lastMessage = messages[messages.length - 1];

  return {
    partner: publicUser(partner),
    lastMessage: lastMessage ? publicMessage(lastMessage, db, requestUser) : null,
    messageCount: messages.length
  };
}

async function handleConversations(request, response) {
  const { db, user } = await requireUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to view chats." });
    return;
  }

  const partnerIds = new Set();

  for (const message of db.messages) {
    if (message.fromUserId === user.id) {
      partnerIds.add(message.toUserId);
    }

    if (message.toUserId === user.id) {
      partnerIds.add(message.fromUserId);
    }
  }

  const conversations = [...partnerIds].map((partnerId) => {
    const partner = db.users.find((candidate) => candidate.id === partnerId);
    const messages = db.messages
      .filter((message) => {
        return (message.fromUserId === user.id && message.toUserId === partnerId) ||
          (message.fromUserId === partnerId && message.toUserId === user.id);
      })
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    return partner ? publicConversation(partner, messages, db, user) : null;
  }).filter(Boolean).sort((left, right) => {
    const leftTime = left.lastMessage ? new Date(left.lastMessage.createdAt).getTime() : 0;
    const rightTime = right.lastMessage ? new Date(right.lastMessage.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });

  sendJson(response, 200, { conversations });
}

async function handleMessages(request, response, partnerId) {
  const { db, user } = await requireUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Sign in to chat." });
    return;
  }

  const partner = db.users.find((candidate) => candidate.id === partnerId);

  if (!partner) {
    sendJson(response, 404, { error: "This author was not found." });
    return;
  }

  if (partner.id === user.id) {
    sendJson(response, 400, { error: "You cannot chat with yourself." });
    return;
  }

  if (request.method === "GET") {
    const messages = db.messages
      .filter((message) => {
        return (message.fromUserId === user.id && message.toUserId === partner.id) ||
          (message.fromUserId === partner.id && message.toUserId === user.id);
      })
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .map((message) => publicMessage(message, db, user));

    sendJson(response, 200, { messages, partner: publicUser(partner) });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const data = await readJson(request);
  const body = String(data.body || "").trim();

  if (body.length < 1 || body.length > 1000) {
    sendJson(response, 400, { error: "Messages must be between 1 and 1000 characters." });
    return;
  }

  const message = {
    id: randomBytes(12).toString("hex"),
    body,
    createdAt: new Date().toISOString(),
    fromUserId: user.id,
    toUserId: partner.id
  };

  db.messages.push(message);
  await saveDb(db);

  sendJson(response, 201, { message: publicMessage(message, db, user), partner: publicUser(partner) });
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (requestUrl.pathname === "/api/session" && request.method === "GET") {
      const db = await loadDb();
      const user = await getRequestUser(request, db);
      sendJson(response, 200, { user: publicUser(user) });
      return;
    }

    if (requestUrl.pathname === "/api/signup" && request.method === "POST") {
      await handleSignup(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/signin" && request.method === "POST") {
      await handleSignin(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/signout" && request.method === "POST") {
      await handleSignout(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/gallery" && request.method === "GET") {
      const db = await loadDb();
      const user = await getRequestUser(request, db);
      sendJson(response, 200, { items: await listGalleryItems(db, user) });
      return;
    }

    if (requestUrl.pathname === "/api/artworks" && request.method === "POST") {
      await handleUpload(request, response);
      return;
    }

    const artworkMatch = requestUrl.pathname.match(/^\/api\/artworks\/([^/]+)$/);

    if (artworkMatch && request.method === "PATCH") {
      await handleArtworkUpdate(request, response, artworkMatch[1]);
      return;
    }

    if (artworkMatch && request.method === "DELETE") {
      await handleArtworkDelete(request, response, artworkMatch[1]);
      return;
    }

    const commentsMatch = requestUrl.pathname.match(/^\/api\/artworks\/([^/]+)\/comments$/);

    if (commentsMatch) {
      await handleComments(request, response, commentsMatch[1]);
      return;
    }

    const likesMatch = requestUrl.pathname.match(/^\/api\/artworks\/([^/]+)\/likes$/);

    if (likesMatch && request.method === "POST") {
      await handleLikeToggle(request, response, likesMatch[1]);
      return;
    }

    if (requestUrl.pathname === "/api/conversations" && request.method === "GET") {
      await handleConversations(request, response);
      return;
    }

    const messagesMatch = requestUrl.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);

    if (messagesMatch) {
      await handleMessages(request, response, messagesMatch[1]);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "API route was not found." });
      return;
    }

    if (requestUrl.pathname.startsWith("/media/")) {
      const filePath = safeJoin(MEDIA_DIR, requestUrl.pathname.replace(/^\/media\//, ""));
      await serveFile(request, response, filePath);
      return;
    }

    const sitePath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname;
    const filePath = safeJoin(SITE_DIR, sitePath);
    await serveFile(request, response, filePath);
  } catch (error) {
    const message = error instanceof SyntaxError ? "Invalid JSON." : error.message;
    sendJson(response, 400, { error: message || "Bad request" });
  }
}

createServer(handleRequest).listen(PORT, () => {
  console.log(`FM Gallery is running at http://localhost:${PORT}`);
});
