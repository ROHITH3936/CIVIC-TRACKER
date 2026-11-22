# CivicTrack updated build

This update connects the agreed reporting and resolution workflow across the browser, FastAPI service and MySQL schema.

## What changed

- Removed demo/sample labels and the development API status panel from the sign-in screen.
- Added browser GPS capture, reverse-geocoded address suggestion, map preview, manual address entry and manual latitude/longitude pin adjustment.
- Added authenticated sessions that survive refresh and can be revoked at sign-out. The server stores only a SHA-256 hash of each session token.
- Added server-side authentication and administrator checks to protected API operations. A citizen can create and review only their own complaints.
- Added a citizen-only My Reports endpoint and real department/category lookup endpoints.
- Added a completion-photo requirement before an administrator can set a complaint to RESOLVED.
- Added citizen confirmation/dispute review. A dispute reopens the complaint as IN_PROGRESS, records the reason in status history and notifies administrators.
- Added similar-report counts based on the same category and normalized location text.
- Added image signature checks, size checks and public image URLs for issue and completion photos.
- Added database tables for sessions and resolution reviews.

## Existing database upgrade

1. Back up the existing `civic_tracker` database.
2. Open `database/civictrack_feature_migration.sql` in MySQL Workbench.
3. Select the `civic_tracker` schema and execute the migration once. It uses `CREATE TABLE IF NOT EXISTS` and can be run again safely.
4. Keep the existing users, departments, categories and complaint records. No existing table is dropped.

For a brand-new database, use `database/database civic tracker.sql`; it now also creates the two new tables.

## Backend run

Run from the `backend` directory:

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME=civic_tracker`. Set `CORS_ORIGINS` to a comma-separated list containing the exact frontend origin(s). Then run:

```bash
uvicorn main:app --reload
```

The API uses the `backend.py` application. `main.py` is a small compatible entry point.

## Frontend run

Serve the `frontend` directory through VS Code Live Server or another local HTTP server. Do not open `index.html` as a `file://` URL; browser geolocation requires a secure context (HTTPS or localhost). Set `frontend/config.js` to the backend URL.

## Deployment settings

- Backend environment variables: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `CORS_ORIGINS`, and optionally `SESSION_DAYS`.
- Frontend origin currently configured in the backend defaults: `https://civictracker-ns4y.onrender.com`.
- Backend URL currently configured in `frontend/config.js`: `https://civic-tracker-api-nxqu.onrender.com`.
- Uploaded files are stored on disk. Render's ordinary service filesystem may be ephemeral; attach a persistent disk and set `UPLOAD_DIR` to a directory on that disk (for example `/var/data/civictrack-uploads`) before relying on uploaded images in production.
- The frontend uses a bearer token in browser local storage for refresh persistence. Keep all user-generated content escaped and avoid adding unsafe HTML injection points.

## Verification boundary

The source files were syntax-checked (Python compile and JavaScript parse). A live end-to-end test still requires the team's actual MySQL database, its migration, valid database credentials, and the deployed frontend/backend origins. Do not treat a successful local syntax check as proof that the hosted service is connected to the database.
