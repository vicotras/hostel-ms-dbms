# Hostel Management System

A hostel management web app built with Node.js, Express, Oracle Database, and plain HTML/CSS/JavaScript.

## Requirements

- Node.js 24 or newer
- Oracle Database Free, with the project schema created
- Oracle SQL*Plus

## Run locally

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and enter your Oracle username, password, and connect string. Keep `.env` private; it is ignored by Git.

3. Start the app:

   ```powershell
   node server.js
   ```

4. Open <http://localhost:3000>.

If port 3000 is already in use, stop the other server or set a different `PORT` before starting.

## Database setup

SQL scripts are in [`sql/`](sql/). See [`docs/DBMS_PROJECT.md`](docs/DBMS_PROJECT.md) for the project schema and setup notes. Review scripts before running them: some are intended for initial setup or data reset.

## Main features

- Admin and warden management pages
- Student accounts and student portal
- Students, rooms, hostels, and room allocations
- Hostel issues and complaints against hostellers
- Leave requests and visitors
