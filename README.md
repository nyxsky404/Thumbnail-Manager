# Thumbnail Manager

Self-service thumbnail editor: upload PNG or PSD backgrounds, configure text overlays via a real-time canvas editor, manage default templates per channel.


## Stack

- **Client**: React 18 + TypeScript + Vite, react-konva, Zustand, TailwindCSS
- **Server**: Python 3.11 + FastAPI, SQLAlchemy 2 + Alembic, MySQL, boto3 (AWS S3), psd-tools + Pillow (PSD import), httpx (async Google Fonts proxy)

## Prerequisites

- Node.js 18+
- Python 3.11+
- MySQL 8.0+ (5.7+ minimum)
- AWS account with an S3 bucket configured for public read
- Google Cloud account with the Web Fonts Developer API enabled (free) — key stays **server-side**

## Quick start

### 1. Database

Create an empty MySQL database, e.g.:

```sql
CREATE DATABASE thumbnail_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. AWS S3 bucket

1. Create an S3 bucket (any name).
2. Disable "Block all public access" — uncheck `BlockPublicAcls` and `BlockPublicPolicy`.
3. Add this bucket policy (replace `YOUR_BUCKET`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
       }
     ]
   }
   ```

4. Add a CORS rule on the bucket so the backend proxy can read objects server-side (replace origins as needed):

   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedOrigins": ["http://localhost:8000", "https://your-production-domain.com"],
       "ExposeHeaders": []
     }
   ]
   ```

5. Create an IAM user with `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:GetObject` on the bucket; copy access keys.

### 3. Google Fonts API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/), enable **Web Fonts Developer API**.
2. Create an API key.
3. Restrict the key to your server's IP or referrer — the key is **never sent to the browser** (the backend proxies all Fonts API calls at `/api/fonts/google/*`).

### 4. Server

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env with DATABASE_URL, AWS keys, S3 bucket, GOOGLE_FONTS_API_KEY, etc.

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs available at <http://localhost:8000/docs>.

### 5. Client

```bash
cd client
npm install

cp .env.example .env
# set VITE_API_URL if the server is not on http://localhost:8000

npm run dev
```

Open <http://localhost:5173>.

## Project layout

```
.
├── prd.md
├── documentation.md
├── client/                  # React app
│   └── src/
│       ├── components/      # Canvas, PropertiesPanel, FontPicker, UploadModal, MissingFontsBanner
│       ├── pages/           # Dashboard, Editor
│       ├── stores/          # Zustand stores (templates, editor)
│       ├── types/           # Shared TypeScript types
│       └── lib/             # API client, font helpers
└── server/                  # FastAPI app
    ├── app/
    │   ├── api/             # routers: templates, fonts, google_fonts, health
    │   ├── models/          # SQLAlchemy models
    │   ├── schemas/         # Pydantic schemas
    │   ├── services/        # S3 client, PSD import pipeline
    │   ├── db.py
    │   ├── config.py
    │   └── main.py
    ├── alembic/             # migrations
    └── requirements.txt
```

## Environment variables

### `server/.env`

| Var | Description |
|---|---|
| `DATABASE_URL` | e.g. `mysql+pymysql://user:pass@localhost:3306/thumbnail_manager` |
| `AWS_REGION` | e.g. `us-east-1` |
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret |
| `S3_BUCKET_NAME` | Bucket name |
| `S3_PUBLIC_BASE_URL` | Optional override (e.g. CloudFront URL); auto-derived if empty |
| `SERVER_BASE_URL` | Public base URL of this server; default `http://localhost:8000` (used to build same-origin proxy URLs returned to the client) |
| `PORT` | Default `8000` |
| `CLIENT_ORIGIN` | Default `http://localhost:5173` (used for CORS) |
| `GOOGLE_FONTS_API_KEY` | Google Fonts Developer API key — kept server-side, never sent to the browser; falls back to a curated list if empty |

### `client/.env`

| Var | Description |
|---|---|
| `VITE_API_URL` | Default `http://localhost:8000` |

## Key features

- Upload **PNG or PSD** → choose 16:9 (1280×720) or 9:16 (1080×1920) preset
- **PSD import pipeline**: composites all layers via `psd-tools`, resizes to the chosen preset (contain-fit), extracts text layers (content, position, font, weight, size, colour, alignment) into editable canvas elements
- **Missing-fonts banner**: PSD fonts not found in the Google Fonts catalog fall back to Roboto; a banner prompts the user to upload a TTF/OTF for each missing family
- Real-time Konva canvas editor with drag/resize text elements
- Properties panel: typography, alignment, styling, position, shadow
- **Server-side Google Fonts proxy** at `/api/fonts/google/*` — the API key never leaves the backend; bypasses ad-blockers and corporate DNS that commonly block `fonts.googleapis.com`
- Per-template custom font upload (TTF/OTF, multi-weight families)
- **Same-origin S3 proxy** — thumbnail and font files are streamed via `/api/templates/{id}/thumbnail` and `/api/templates/{id}/fonts/{fontId}/file`; the browser never hits S3 directly
- Default-template marker (race-safe single-statement update; auto-promotion on delete)
- Client-side PNG export at full preset resolution
- Dirty-state guards for tab close + in-app navigation
- `/health` endpoint with DB ping
- Rate limiting (SlowAPI, 120 req/min default) on all endpoints

## API summary

| Method | Path |
|---|---|
| GET | `/health` |
| GET / POST | `/api/templates` |
| GET / PATCH / DELETE | `/api/templates/{id}` |
| POST | `/api/templates/{id}/default` |
| GET | `/api/templates/{id}/thumbnail` |
| POST | `/api/templates/{id}/fonts` |
| GET / DELETE | `/api/templates/{id}/fonts/{fontId}` |
| GET | `/api/templates/{id}/fonts/{fontId}/file` |
| GET | `/api/fonts/google/list` |
| GET | `/api/fonts/google/css` |
| GET | `/api/fonts/google/file` |

Full schema and validation rules at <http://localhost:8000/docs>.

## Out of scope

Canva import, server-side render, multi-user auth, layer/z-index reordering, image overlays, undo/redo, autosave, inline canvas text editing.

## Production hardening checklist

- Switch S3 to private bucket + pre-signed URLs (or CloudFront in front)
- Restrict Google Fonts API key to your server's IP or service account
- Set `SERVER_BASE_URL` to your public HTTPS domain
- Enable HTTPS / TLS termination
- Tune SlowAPI limits (`default_limits` in `app/main.py`)
- Configure structured logging shipping (e.g. JSON logs → Loki/CloudWatch)
- Add monitoring hooks on `/health`
- Set strong MySQL credentials, enable SSL on the connection string
