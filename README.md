# FM Gallery Website

This is a local website for showing FM pictures, paintings, creative images, and short videos with accounts, uploads, likes, comments, and author chats.

## Open The Website

From this folder, run:

```bash
npm start
```

Then open:

```text
http://localhost:4177
```

## Accounts And Uploads

- Create an account from the top-right button.
- Sign in to upload pictures, paintings, creative images, or short videos.
- Open one of your own works to rename or delete it.
- Signed-in visitors can like and comment on any visible work.
- Signed-in visitors can chat directly with the author of an uploaded work.
- Everyone can view the public gallery.

Account data, uploaded artwork records, and comments are stored locally in `data/db.json`.

## Going Live On `fmgallery.co`

The site should be hosted as a Node.js app with permanent storage, because visitor accounts, uploaded media, likes, comments, and chats are saved by the server.

Recommended live setup:

1. Deploy this folder to a host that supports a persistent disk, such as Render, Railway, Fly.io, DigitalOcean, or a VPS.
2. Set these environment variables on the host:

```text
DATA_DIR=/path/to/permanent/data
MEDIA_DIR=/path/to/permanent/media
```

`DB_FILE` is optional. If it is not set, the app stores its database at `DATA_DIR/db.json`.

3. Copy the current `data` and `media` folders to those permanent storage folders if you want the existing local accounts and artwork to appear online.
4. In the DNS manager for `fmgallery.co`, point the domain to the host using the records the host provides. Usually this means:

```text
@     A       host IP address
www   CNAME   host-provided domain
```

The domain currently uses GoDaddy-style nameservers, so the DNS records need to be added in the GoDaddy domain/DNS account unless the nameservers are changed.

Plain Vercel serverless hosting is not enough for this version by itself, because local uploads and `data/db.json` are not permanent there. Vercel can still be used after moving the database to Postgres/Neon and uploaded files to Blob storage.

## Folder-Based Media

You can still add files manually:

- Put image files in `media/paintings`
- Put video files in `media/videos`
- Optional video poster images can go in `media/posters` with the same filename as the video

Supported image formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`

Supported video formats: `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogg`

The gallery refresh button reloads the media list after you add or remove files.
