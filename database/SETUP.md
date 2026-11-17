# MySQL Setup (Custom LMS)

This project now runs on **MySQL 8** instead of Microsoft SQL Server.

## 1. Create the database and tables

1. Open **MySQL Workbench** and connect to your local MySQL server.
2. `File -> Open SQL Script...` and select:
   ```
   database/lms_mysql_schema.sql
   ```
3. Click the ⚡ **Execute** button (or press `Ctrl + Shift + Enter`).

The script will:

- create the `LMS` database (utf8mb4),
- create all 20 core LMS tables,
- create the 6 EMS tables (`ems_*`),
- insert seed departments/designations,
- insert optional demo users/course/batch (IDs 1–3, mobile `9000000001`–`9000000003`).

It is safe to run more than once — it uses `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE`.

## 2. Configure the backend

Edit `backend/.env`:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=LMS
```

`DB_SERVER` is still accepted as a fallback for `DB_HOST`.

## 3. Run the backend

```powershell
cd backend
npm install
npm run dev
```

You should see:

```
Connected to MySQL (LMS) successfully!
TypeScript Server running on port 5000
```

## 4. Optional: run the migration script instead of Workbench

```powershell
cd backend
npx tsx src/config/migrate_ems.ts
```

This executes the same `database/lms_mysql_schema.sql` file and prints the created tables.

## 5. Optional: load full demo data for every screen

To preview the whole app with realistic data (students, curriculum, live classes,
recordings, attendance, assignments, tests, announcements, chat, certificates and
the EMS module), run from the project root:

```powershell
node database/seed_demo_data.cjs
```

Notes:

- The script is **idempotent** — running it again only inserts rows that are missing.
- It reads the database settings from `backend/.env`.
- Start the backend first if you also want it to generate real certificate PDFs
  (it calls `POST /api/certificates` for the demo students).

## 6. Upgrading an existing database (certificate editing)

Newer builds let admins **preview and edit** a certificate (printed name, course
title, batch label, issue date, certificate number). That needs three extra nullable
columns on `certificates`. Existing databases can be upgraded with:

```sql
ALTER TABLE certificates
  ADD COLUMN recipient_name VARCHAR(150) NULL AFTER issued_at,
  ADD COLUMN course_title   VARCHAR(200) NULL AFTER recipient_name,
  ADD COLUMN batch_label    VARCHAR(80)  NULL AFTER course_title;
```

The same columns are already part of `database/lms_mysql_schema.sql`, so fresh
installs do not need this step.

## Notes

- The backend uses `mysql2` together with a small compatibility layer
  (`backend/src/config/db.ts` + `backend/src/config/sqlTranslator.ts`) so the existing
  SQL Server style queries (`@params`, `OUTPUT INSERTED.*`) keep working.
- If you already have data in SQL Server and want to move it, export each table to CSV
  and import it into MySQL (Workbench: `Table Data Import Wizard`), then run the schema
  first so the target tables exist.
