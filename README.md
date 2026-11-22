# CivicTrack

CivicTrack is a citizen-facing civic issue reporting and tracking application with an administrator workflow for assigning and resolving complaints.

## Project folders

- `frontend/` — HTML, CSS and JavaScript interface.
- `backend/` — FastAPI application and Python dependencies.
- `database/` — MySQL schema and the upgrade migration for the new features.

## First-time setup

1. Create the MySQL database by running `database/database civic tracker.sql` in MySQL Workbench.
2. Copy `backend/.env.example` to `backend/.env` and fill in the MySQL connection settings.
3. From `backend/`, install `requirements.txt` and run `uvicorn main:app --reload`.
4. Set the backend URL in `frontend/config.js` and serve `frontend/index.html` through Live Server.
5. Register a citizen account. Create administrator accounts separately by assigning the `ADMIN` role to an authorized user in MySQL; public registration cannot create admins.

## Upgrading an existing database

Back up the database first, then run `database/civictrack_feature_migration.sql` in MySQL Workbench. Do not recreate or drop the existing tables.

See `IMPLEMENTATION_NOTES.md` for feature details, deployment configuration and verification limits.
