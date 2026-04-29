# Thumbnail Manager

Self-service thumbnail editor: upload background PNGs, configure text overlays via a real-time canvas editor, manage default templates per channel.

See `prd.md` for the product spec and `documentation.md` for full architecture/timeline.

## Stack

- **Client**: React 18 + TypeScript + Vite, react-konva, Zustand, TailwindCSS
- **Server**: Python 3.11 + FastAPI, SQLAlchemy 2 + Alembic, MySQL, boto3 (AWS S3)

## Prerequisites

- Node.js 18+
- Python 3.11+
- MySQL 8.0+ (5.7+ minimum)
- AWS account with an S3 bucket configured for public read
- Google Cloud account with the Web Fonts Developer API enabled (free)

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

4. Add a CORS rule on the bucket (so the browser can fetch font files via `FontFace` API):

   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedOrigins": ["http://localhost:5173"],
       "ExposeHeaders": []
     }
   ]
   ```

5. Create an IAM user with `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the bucket; copy access keys.

### 3. Google Fonts API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/), enable **Web Fonts Developer API**.
2. Create an API key.
3. Restrict the key by HTTP referrer to `http://localhost:5173/*` (and your production origin later).

### 4. Server

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env with DATABASE_URL, AWS keys, S3 bucket, etc.

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs available at <http://localhost:8000/docs>.

### 5. Client

```bash
cd client
npm install

cp .env.example .env
# set VITE_GOOGLE_FONTS_API_KEY

npm run dev
```

Open <http://localhost:5173>.

## Project layout

```
.
├── prd.md
├── documentation.md
├── client/                  # React app
└── server/                  # FastAPI app
    ├── app/
    │   ├── api/             # routers (templates, fonts, health)
    │   ├── models/          # SQLAlchemy models
    │   ├── schemas/         # Pydantic schemas
    │   ├── services/        # S3 client
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
| `PORT` | Default `8000` |
| `CLIENT_ORIGIN` | Default `http://localhost:5173` (used for CORS) |

### `client/.env`

| Var | Description |
|---|---|
| `VITE_API_URL` | Default `http://localhost:8000` |
| `VITE_GOOGLE_FONTS_API_KEY` | Required for full Google Fonts search; falls back to a curated list if missing |

## Key features

- Upload PNG → choose 16:9 (1280×720) or 9:16 (1080×1920) preset
- Real-time Konva canvas editor with drag/resize text elements
- Properties panel: typography, alignment, styling, position, shadow
- Full Google Fonts library (with WebFont Loader, weights 400+700 preloaded)
- Per-template custom font upload (TTF/OTF, multi-weight families)
- Default-template marker (race-safe single-statement update; auto-promotion on delete)
- Client-side PNG export at full preset resolution
- Dirty-state guards for tab close + in-app navigation
- `/health` endpoint with DB ping
- Rate limiting (SlowAPI) on all endpoints

## API summary

| Method | Path |
|---|---|
| GET | `/health` |
| GET / POST | `/api/templates` |
| GET / PATCH / DELETE | `/api/templates/{id}` |
| POST | `/api/templates/{id}/default` |
| POST | `/api/templates/{id}/fonts` |
| DELETE | `/api/templates/{id}/fonts/{fontId}` |

Full schema and validation rules at <http://localhost:8000/docs>.

## Out of scope (per PRD)

PSD parsing, Canva import, server-side render, multi-user auth, layer/z-index, image overlays, undo/redo, autosave, inline canvas text editing.

## Production hardening checklist

- Switch S3 to private bucket + pre-signed URLs (or CloudFront in front)
- Restrict GCP API key by HTTPS referrer (production origin)
- Enable HTTPS / TLS termination
- Tune SlowAPI limits (`default_limits` in `app/main.py`)
- Configure structured logging shipping (e.g. JSON logs → Loki/CloudWatch)
- Add monitoring hooks on `/health`
- Set strong MySQL credentials, enable SSL on the connection string
