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

## Notes

- The backend uses `mysql2` together with a small compatibility layer
  (`backend/src/config/db.ts` + `backend/src/config/sqlTranslator.ts`) so the existing
  SQL Server style queries (`@params`, `OUTPUT INSERTED.*`) keep working.
- If you already have data in SQL Server and want to move it, export each table to CSV
  and import it into MySQL (Workbench: `Table Data Import Wizard`), then run the schema
  first so the target tables exist.
