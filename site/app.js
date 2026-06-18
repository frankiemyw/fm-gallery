const state = {
  activeFilter: "all",
  activeIndex: 0,
  authMode: "signin",
  chatPartner: null,
  comments: [],
  conversations: [],
  items: [],
  messages: [],
  query: "",
  sort: "newest",
  user: null,
  visibleItems: []
};

const elements = {
  accountMeta: document.querySelector("#accountMeta"),
  accountName: document.querySelector("#accountName"),
  accountPanel: document.querySelector("#accountPanel"),
  accountPill: document.querySelector("#accountPill"),
  authClose: document.querySelector("#authClose"),
  authEmail: document.querySelector("#authEmail"),
  authError: document.querySelector("#authError"),
  authForm: document.querySelector("#authForm"),
  authModal: document.querySelector("#authModal"),
  authName: document.querySelector("#authName"),
  authPassword: document.querySelector("#authPassword"),
  authSubmit: document.querySelector("#authSubmit"),
  authSwitch: document.querySelector("#authSwitch"),
  authTitle: document.querySelector("#authTitle"),
  chatAuthorButton: document.querySelector("#chatAuthorButton"),
  chatBody: document.querySelector("#chatBody"),
  chatClose: document.querySelector("#chatClose"),
  chatForm: document.querySelector("#chatForm"),
  chatMessages: document.querySelector("#chatMessages"),
  chatModal: document.querySelector("#chatModal"),
  chatPrompt: document.querySelector("#chatPrompt"),
  chatsButton: document.querySelector("#chatsButton"),
  chatTitle: document.querySelector("#chatTitle"),
  collectionGrid: document.querySelector("#collectionGrid"),
  commentBody: document.querySelector("#commentBody"),
  commentForm: document.querySelector("#commentForm"),
  commentList: document.querySelector("#commentList"),
  commentPrompt: document.querySelector("#commentPrompt"),
  deleteArtworkButton: document.querySelector("#deleteArtworkButton"),
  emptyState: document.querySelector("#emptyState"),
  featuredMedia: document.querySelector("#featuredMedia"),
  featuredMeta: document.querySelector("#featuredMeta"),
  featuredTitle: document.querySelector("#featuredTitle"),
  filterButtons: [...document.querySelectorAll(".filter-button")],
  likeButton: document.querySelector("#likeButton"),
  mineFilterButton: document.querySelector("#mineFilterButton"),
  nameField: document.querySelector("#nameField"),
  ownerDescriptionInput: document.querySelector("#ownerDescriptionInput"),
  ownerTitleInput: document.querySelector("#ownerTitleInput"),
  ownerTools: document.querySelector("#ownerTools"),
  paintingCount: document.querySelector("#paintingCount"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  searchInput: document.querySelector("#searchInput"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  signUpButton: document.querySelector("#signUpButton"),
  sortSelect: document.querySelector("#sortSelect"),
  statusMessage: document.querySelector("#statusMessage"),
  totalCount: document.querySelector("#totalCount"),
  uploadButton: document.querySelector("#uploadButton"),
  uploadClose: document.querySelector("#uploadClose"),
  uploadDescriptionInput: document.querySelector("#uploadDescriptionInput"),
  uploadError: document.querySelector("#uploadError"),
  uploadFile: document.querySelector("#uploadFile"),
  uploadForm: document.querySelector("#uploadForm"),
  uploadModal: document.querySelector("#uploadModal"),
  uploadTitleInput: document.querySelector("#uploadTitleInput"),
  uploadType: document.querySelector("#uploadType"),
  videoCount: document.querySelector("#videoCount"),
  viewer: document.querySelector("#viewer"),
  viewerClose: document.querySelector("#viewerClose"),
  viewerDescription: document.querySelector("#viewerDescription"),
  viewerMedia: document.querySelector("#viewerMedia"),
  viewerMeta: document.querySelector("#viewerMeta"),
  viewerNext: document.querySelector("#viewerNext"),
  viewerPrev: document.querySelector("#viewerPrev"),
  viewerTitle: document.querySelector("#viewerTitle")
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character]));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function currentItem() {
  return state.visibleItems[state.activeIndex] || null;
}

function mediaMarkup(item, context = "card") {
  const title = escapeHtml(item.title);
  const source = escapeHtml(item.src);
  const poster = item.poster ? ` poster="${escapeHtml(item.poster)}"` : "";

  if (item.type === "video") {
    const controls = context === "viewer" ? " controls" : "";
    const muted = context === "viewer" ? "" : " muted";
    return `<video src="${source}"${poster} preload="metadata" playsinline${muted}${controls}></video>`;
  }

  return `<img src="${source}" alt="${title}" loading="${context === "card" ? "lazy" : "eager"}">`;
}

function itemMeta(item) {
  const label = item.type === "video" ? "Short video" : "Creative image";
  const artist = item.ownerName || "Studio Archive";
  return `${label} - ${artist} - ${formatDate(item.createdAt)}`;
}

function itemDescription(item) {
  return String(item?.description || "").trim();
}

function descriptionPreview(item) {
  const description = itemDescription(item);

  if (!description) {
    return "";
  }

  return description.length > 118 ? `${description.slice(0, 115).trim()}...` : description;
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  });

  return parseJsonResponse(response);
}

function showStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.add("is-visible");
  window.clearTimeout(showStatus.timeout);
  showStatus.timeout = window.setTimeout(() => {
    elements.statusMessage.classList.remove("is-visible");
  }, 2600);
}

function anyOverlayOpen(exceptModal = null) {
  return elements.viewer.classList.contains("is-open") ||
    (exceptModal !== elements.authModal && elements.authModal.classList.contains("is-open")) ||
    (exceptModal !== elements.uploadModal && elements.uploadModal.classList.contains("is-open")) ||
    (exceptModal !== elements.chatModal && elements.chatModal.classList.contains("is-open"));
}

function setModalOpen(modal, isOpen) {
  modal.classList.toggle("is-open", isOpen);
  modal.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("modal-open", isOpen || anyOverlayOpen(modal));
}

function openAuth(mode = "signin") {
  state.authMode = mode;
  const isSignup = mode === "signup";

  elements.authTitle.textContent = isSignup ? "Create account" : "Sign in";
  elements.authSubmit.textContent = isSignup ? "Create account" : "Sign in";
  elements.authSwitch.textContent = isSignup ? "Use an existing account" : "Create an account";
  elements.nameField.hidden = !isSignup;
  elements.authName.required = isSignup;
  elements.authPassword.autocomplete = isSignup ? "new-password" : "current-password";
  elements.authError.textContent = "";
  setModalOpen(elements.authModal, true);
  (isSignup ? elements.authName : elements.authEmail).focus();
}

function closeAuth() {
  setModalOpen(elements.authModal, false);
  elements.authForm.reset();
  elements.authError.textContent = "";
}

function openUpload() {
  if (!state.user) {
    openAuth("signin");
    return;
  }

  elements.uploadError.textContent = "";
  setModalOpen(elements.uploadModal, true);
  elements.uploadTitleInput.focus();
}

function closeUpload() {
  setModalOpen(elements.uploadModal, false);
  elements.uploadForm.reset();
  elements.uploadError.textContent = "";
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();

  let items = state.items.filter((item) => {
    const matchesFilter =
      state.activeFilter === "all" ||
      item.type === state.activeFilter ||
      (state.activeFilter === "mine" && state.user && item.ownerId === state.user.id);
    const matchesSearch = !query ||
      item.title.toLowerCase().includes(query) ||
      itemDescription(item).toLowerCase().includes(query) ||
      item.filename.toLowerCase().includes(query) ||
      String(item.ownerName || "").toLowerCase().includes(query);
    return matchesFilter && matchesSearch;
  });

  items = [...items].sort((left, right) => {
    if (state.sort === "oldest") {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    }

    if (state.sort === "az") {
      return left.title.localeCompare(right.title);
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  state.visibleItems = items;
}

function renderAccount() {
  const signedIn = Boolean(state.user);
  const myWorks = signedIn ? state.items.filter((item) => item.ownerId === state.user.id).length : 0;

  elements.accountPill.hidden = !signedIn;
  elements.accountPanel.hidden = !signedIn;
  elements.uploadButton.hidden = !signedIn;
  elements.chatsButton.hidden = !signedIn;
  elements.signOutButton.hidden = !signedIn;
  elements.signInButton.hidden = signedIn;
  elements.signUpButton.hidden = signedIn;
  elements.mineFilterButton.hidden = !signedIn;

  if (!signedIn && state.activeFilter === "mine") {
    state.activeFilter = "all";
  }

  if (signedIn) {
    elements.accountPill.textContent = state.user.name;
    elements.accountName.textContent = state.user.name;
    elements.accountMeta.textContent = `${myWorks} ${myWorks === 1 ? "work" : "works"} published`;
  }
}

function renderStats() {
  const paintings = state.items.filter((item) => item.type === "painting").length;
  const videos = state.items.filter((item) => item.type === "video").length;

  elements.totalCount.textContent = state.items.length;
  elements.paintingCount.textContent = paintings;
  elements.videoCount.textContent = videos;
  elements.resultCount.textContent = `${state.visibleItems.length} ${state.visibleItems.length === 1 ? "work" : "works"}`;
}

function renderFeatured() {
  const [item] = state.visibleItems;

  if (!item) {
    elements.featuredTitle.textContent = state.items.length ? "No matching works" : "Gallery ready";
    elements.featuredMeta.textContent = state.items.length ? "Try another search or filter." : "Your collection will appear here.";
    elements.featuredMedia.innerHTML = `<span class="empty-frame">${state.items.length ? "No match" : "No media yet"}</span>`;
    elements.featuredMedia.disabled = true;
    delete elements.featuredMedia.dataset.id;
    return;
  }

  elements.featuredTitle.textContent = item.title;
  elements.featuredMeta.textContent = itemMeta(item);
  elements.featuredMedia.innerHTML = mediaMarkup(item, "featured");
  elements.featuredMedia.disabled = false;
  elements.featuredMedia.dataset.id = item.id;
}

function renderGrid() {
  elements.collectionGrid.innerHTML = state.visibleItems.map((item) => `
    <article class="art-card">
      <button class="art-card-button" type="button" data-id="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.title)}">
        <span class="art-media">
          ${mediaMarkup(item)}
        </span>
        <span class="art-info">
          <strong>${escapeHtml(item.title)}</strong>
          ${descriptionPreview(item) ? `<p>${escapeHtml(descriptionPreview(item))}</p>` : ""}
          <span>${escapeHtml(itemMeta(item))}</span>
          <small>${item.likeCount} ${item.likeCount === 1 ? "like" : "likes"} - ${item.commentCount} ${item.commentCount === 1 ? "comment" : "comments"}</small>
        </span>
      </button>
    </article>
  `).join("");

  elements.emptyState.classList.toggle("is-visible", state.visibleItems.length === 0);
}

function renderFilters() {
  for (const button of elements.filterButtons) {
    const isActive = button.dataset.filter === state.activeFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function renderOwnerTools(item) {
  if (!item?.canEdit) {
    elements.ownerTools.hidden = true;
    return;
  }

  elements.ownerTools.hidden = false;
  elements.ownerTitleInput.value = item.title;
  elements.ownerDescriptionInput.value = itemDescription(item);
}

function renderReviewActions(item) {
  const likeCount = item?.likeCount || 0;
  const liked = Boolean(item?.likedByMe);
  const canShowChat = Boolean(item?.ownerId && (!state.user || item.ownerId !== state.user.id));

  elements.likeButton.textContent = `${liked ? "Liked" : "Like"} (${likeCount})`;
  elements.likeButton.classList.toggle("is-liked", liked);
  elements.likeButton.dataset.id = item?.id || "";
  elements.chatAuthorButton.hidden = !canShowChat;
  elements.chatAuthorButton.textContent = item?.ownerName ? `Chat with ${item.ownerName}` : "Chat with author";
  elements.chatAuthorButton.dataset.partnerId = item?.ownerId || "";
  elements.chatAuthorButton.dataset.partnerName = item?.ownerName || "Author";
}

function renderComments() {
  if (!state.comments.length) {
    elements.commentList.innerHTML = `<p class="comment-empty">No comments yet.</p>`;
  } else {
    elements.commentList.innerHTML = state.comments.map((comment) => `
      <article class="comment-item">
        <strong>${escapeHtml(comment.authorName)}</strong>
        <span>${formatDate(comment.createdAt)}</span>
        <p>${escapeHtml(comment.body)}</p>
      </article>
    `).join("");
  }

  elements.commentForm.hidden = !state.user;
  elements.commentPrompt.hidden = Boolean(state.user);
  elements.commentPrompt.textContent = "Sign in to like, comment, and chat with authors.";
}

function renderViewerDetails(item) {
  elements.viewerTitle.textContent = item.title;
  elements.viewerMeta.textContent = itemMeta(item);
  elements.viewerDescription.textContent = itemDescription(item) || "No description yet.";
  elements.viewerDescription.classList.toggle("is-empty", !itemDescription(item));
  renderReviewActions(item);
  renderOwnerTools(item);
  renderComments();
}

function updateArtwork(id, changes) {
  state.items = state.items.map((item) => item.id === id ? { ...item, ...changes } : item);
  state.visibleItems = state.visibleItems.map((item) => item.id === id ? { ...item, ...changes } : item);
}

function renderConversations() {
  elements.chatTitle.textContent = "Your chats";
  elements.chatForm.hidden = true;
  elements.chatPrompt.hidden = state.conversations.length > 0;
  elements.chatPrompt.textContent = "Open an artwork to chat with its author.";

  if (!state.conversations.length) {
    elements.chatMessages.innerHTML = `<p class="comment-empty">No chats yet.</p>`;
    return;
  }

  elements.chatMessages.innerHTML = state.conversations.map((conversation) => `
    <button class="conversation-item" type="button" data-partner-id="${escapeHtml(conversation.partner.id)}" data-partner-name="${escapeHtml(conversation.partner.name)}">
      <strong>${escapeHtml(conversation.partner.name)}</strong>
      <span>${conversation.lastMessage ? escapeHtml(conversation.lastMessage.body) : "No messages yet"}</span>
    </button>
  `).join("");
}

function renderMessages() {
  elements.chatTitle.textContent = state.chatPartner ? `Chat with ${state.chatPartner.name}` : "Your chats";
  elements.chatForm.hidden = !state.chatPartner;
  elements.chatPrompt.hidden = Boolean(state.chatPartner);

  if (!state.messages.length) {
    elements.chatMessages.innerHTML = `<p class="comment-empty">No messages yet.</p>`;
    return;
  }

  elements.chatMessages.innerHTML = state.messages.map((message) => `
    <article class="chat-message ${message.isMine ? "is-mine" : ""}">
      <strong>${escapeHtml(message.fromName)}</strong>
      <p>${escapeHtml(message.body)}</p>
      <span>${formatDate(message.createdAt)}</span>
    </article>
  `).join("");
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

async function openChatList() {
  if (!state.user) {
    openAuth("signin");
    return;
  }

  state.chatPartner = null;
  state.messages = [];
  elements.chatMessages.innerHTML = `<p class="comment-empty">Loading chats...</p>`;
  setModalOpen(elements.chatModal, true);

  try {
    const data = await api("/api/conversations");
    state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
  } catch (error) {
    showStatus(error.message);
    state.conversations = [];
  }

  renderConversations();
}

async function openChat(partnerId, partnerName = "Author") {
  if (!state.user) {
    openAuth("signin");
    return;
  }

  if (!partnerId || partnerId === state.user.id) {
    showStatus("Choose another author to chat with.");
    return;
  }

  state.chatPartner = { id: partnerId, name: partnerName };
  state.messages = [];
  elements.chatMessages.innerHTML = `<p class="comment-empty">Loading messages...</p>`;
  setModalOpen(elements.chatModal, true);

  try {
    const data = await api(`/api/conversations/${encodeURIComponent(partnerId)}/messages`);
    state.chatPartner = data.partner || state.chatPartner;
    state.messages = Array.isArray(data.messages) ? data.messages : [];
  } catch (error) {
    showStatus(error.message);
    state.messages = [];
  }

  renderMessages();
  elements.chatBody.focus();
}

function closeChat() {
  setModalOpen(elements.chatModal, false);
  state.chatPartner = null;
  state.messages = [];
  state.conversations = [];
  elements.chatBody.value = "";
}

function render() {
  renderAccount();
  applyFilters();
  renderStats();
  renderFeatured();
  renderFilters();
  renderGrid();
}

async function loadSession() {
  const data = await api("/api/session");
  state.user = data.user || null;
}

async function loadGallery() {
  elements.refreshButton.classList.add("is-loading");

  try {
    const response = await fetch("/api/gallery", { credentials: "same-origin" });

    if (!response.ok) {
      throw new Error("Gallery could not be loaded");
    }

    const data = await response.json();
    state.items = Array.isArray(data.items) ? data.items : [];
    render();
  } catch {
    elements.emptyState.classList.add("is-visible");
    elements.emptyState.innerHTML = `
      <p class="eyebrow">Connection</p>
      <h2>Gallery server is not available</h2>
      <p>Start the local gallery server, then reload this page.</p>
    `;
  } finally {
    elements.refreshButton.classList.remove("is-loading");
  }
}

async function refreshAll() {
  await loadSession();
  await loadGallery();
}

function visibleIndexForId(id) {
  return state.visibleItems.findIndex((item) => item.id === id);
}

async function loadComments(artworkId) {
  state.comments = [];
  renderComments();

  try {
    const data = await api(`/api/artworks/${encodeURIComponent(artworkId)}/comments`);
    state.comments = Array.isArray(data.comments) ? data.comments : [];
  } catch {
    state.comments = [];
  }

  renderComments();
}

async function openViewer(index) {
  const item = state.visibleItems[index];

  if (!item) {
    return;
  }

  state.activeIndex = index;
  state.comments = [];
  elements.viewerMedia.innerHTML = mediaMarkup(item, "viewer");
  renderViewerDetails(item);
  elements.viewer.setAttribute("aria-hidden", "false");
  elements.viewer.classList.add("is-open");
  document.body.classList.add("modal-open");
  elements.viewerClose.focus();
  await loadComments(item.id);
}

function closeViewer() {
  elements.viewer.setAttribute("aria-hidden", "true");
  elements.viewer.classList.remove("is-open");
  document.body.classList.toggle("modal-open", anyOverlayOpen());
  elements.viewerMedia.innerHTML = "";
  state.comments = [];
}

function moveViewer(direction) {
  if (!state.visibleItems.length) {
    return;
  }

  const nextIndex = (state.activeIndex + direction + state.visibleItems.length) % state.visibleItems.length;
  openViewer(nextIndex);
}

elements.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeFilter = button.dataset.filter || "all";
    render();
  });
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

elements.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

elements.refreshButton.addEventListener("click", refreshAll);
elements.chatsButton.addEventListener("click", openChatList);
elements.signInButton.addEventListener("click", () => openAuth("signin"));
elements.signUpButton.addEventListener("click", () => openAuth("signup"));
elements.uploadButton.addEventListener("click", openUpload);
elements.authClose.addEventListener("click", closeAuth);
elements.uploadClose.addEventListener("click", closeUpload);
elements.chatClose.addEventListener("click", closeChat);
elements.authSwitch.addEventListener("click", () => openAuth(state.authMode === "signup" ? "signin" : "signup"));

elements.signOutButton.addEventListener("click", async () => {
  await api("/api/signout", { method: "POST", body: JSON.stringify({}) });
  state.user = null;
  closeChat();
  showStatus("Signed out.");
  await loadGallery();
});

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.authError.textContent = "";

  const payload = {
    email: elements.authEmail.value,
    password: elements.authPassword.value
  };

  if (state.authMode === "signup") {
    payload.name = elements.authName.value;
  }

  try {
    const data = await api(state.authMode === "signup" ? "/api/signup" : "/api/signin", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.user = data.user;
    closeAuth();
    showStatus(state.authMode === "signup" ? "Account created." : "Signed in.");
    await loadGallery();
  } catch (error) {
    elements.authError.textContent = error.message;
  }
});

elements.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.uploadError.textContent = "";

  const formData = new FormData();
  formData.set("title", elements.uploadTitleInput.value);
  formData.set("description", elements.uploadDescriptionInput.value);
  formData.set("type", elements.uploadType.value);

  if (elements.uploadFile.files[0]) {
    formData.set("file", elements.uploadFile.files[0]);
  }

  try {
    await api("/api/artworks", {
      method: "POST",
      body: formData
    });
    closeUpload();
    showStatus("Artwork published.");
    state.activeFilter = "mine";
    await loadGallery();
  } catch (error) {
    elements.uploadError.textContent = error.message;
  }
});

elements.featuredMedia.addEventListener("click", () => {
  const index = visibleIndexForId(elements.featuredMedia.dataset.id);
  openViewer(index);
});

elements.collectionGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");

  if (!button) {
    return;
  }

  openViewer(visibleIndexForId(button.dataset.id));
});

elements.collectionGrid.addEventListener("pointerover", (event) => {
  const video = event.target.closest(".art-card")?.querySelector("video");
  video?.play().catch(() => {});
});

elements.collectionGrid.addEventListener("pointerout", (event) => {
  const video = event.target.closest(".art-card")?.querySelector("video");

  if (video) {
    video.pause();
    video.currentTime = 0;
  }
});

elements.viewerClose.addEventListener("click", closeViewer);
elements.viewerPrev.addEventListener("click", () => moveViewer(-1));
elements.viewerNext.addEventListener("click", () => moveViewer(1));
elements.viewer.addEventListener("click", (event) => {
  if (event.target === elements.viewer) {
    closeViewer();
  }
});

elements.likeButton.addEventListener("click", async () => {
  const item = currentItem();

  if (!item) {
    return;
  }

  if (!state.user) {
    openAuth("signin");
    return;
  }

  try {
    const data = await api(`/api/artworks/${encodeURIComponent(item.id)}/likes`, {
      method: "POST",
      body: JSON.stringify({})
    });
    updateArtwork(item.id, data);
    render();
    const nextIndex = visibleIndexForId(item.id);
    if (nextIndex >= 0) {
      state.activeIndex = nextIndex;
      renderViewerDetails(state.visibleItems[nextIndex]);
    }
    showStatus(data.likedByMe ? "Liked." : "Like removed.");
  } catch (error) {
    showStatus(error.message);
  }
});

elements.chatAuthorButton.addEventListener("click", () => {
  openChat(elements.chatAuthorButton.dataset.partnerId, elements.chatAuthorButton.dataset.partnerName);
});

elements.chatMessages.addEventListener("click", (event) => {
  const conversation = event.target.closest("[data-partner-id]");

  if (!conversation) {
    return;
  }

  openChat(conversation.dataset.partnerId, conversation.dataset.partnerName);
});

elements.ownerTools.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = currentItem();

  if (!item) {
    return;
  }

  try {
    await api(`/api/artworks/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: elements.ownerDescriptionInput.value,
        title: elements.ownerTitleInput.value
      })
    });
    showStatus("Artwork updated.");
    await loadGallery();
    const nextIndex = visibleIndexForId(item.id);
    if (nextIndex >= 0) {
      state.activeIndex = nextIndex;
      renderViewerDetails(state.visibleItems[nextIndex]);
    }
  } catch (error) {
    showStatus(error.message);
  }
});

elements.deleteArtworkButton.addEventListener("click", async () => {
  const item = currentItem();

  if (!item || !window.confirm(`Delete "${item.title}"?`)) {
    return;
  }

  try {
    await api(`/api/artworks/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    showStatus("Artwork deleted.");
    closeViewer();
    await loadGallery();
  } catch (error) {
    showStatus(error.message);
  }
});

elements.commentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = currentItem();

  if (!item) {
    return;
  }

  try {
    await api(`/api/artworks/${encodeURIComponent(item.id)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: elements.commentBody.value })
    });
    elements.commentBody.value = "";
    await loadComments(item.id);
    await loadGallery();
    const nextIndex = visibleIndexForId(item.id);
    if (nextIndex >= 0) {
      state.activeIndex = nextIndex;
      renderViewerDetails(state.visibleItems[nextIndex]);
    }
    showStatus("Comment posted.");
  } catch (error) {
    showStatus(error.message);
  }
});

elements.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.chatPartner) {
    return;
  }

  try {
    const data = await api(`/api/conversations/${encodeURIComponent(state.chatPartner.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: elements.chatBody.value })
    });
    state.chatPartner = data.partner || state.chatPartner;
    elements.chatBody.value = "";
    await openChat(state.chatPartner.id, state.chatPartner.name);
    showStatus("Message sent.");
  } catch (error) {
    showStatus(error.message);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (elements.authModal.classList.contains("is-open")) {
      closeAuth();
      return;
    }

    if (elements.uploadModal.classList.contains("is-open")) {
      closeUpload();
      return;
    }

    if (elements.chatModal.classList.contains("is-open")) {
      closeChat();
      return;
    }
  }

  if (!elements.viewer.classList.contains("is-open")) {
    return;
  }

  if (event.key === "Escape") {
    closeViewer();
  }

  if (event.key === "ArrowLeft") {
    moveViewer(-1);
  }

  if (event.key === "ArrowRight") {
    moveViewer(1);
  }
});

refreshAll();
