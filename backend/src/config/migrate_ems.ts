import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

/**
 * Runs the complete MySQL schema (core LMS + EMS tables + seed data).
 *
 * The schema file is idempotent, so running this script repeatedly is safe.
 * You can also open `database/lms_mysql_schema.sql` directly in MySQL Workbench.
 */
async function runMigration() {
    console.log('🚀 Running LMS/EMS schema migration on MySQL...');

    const schemaPath = path.join(__dirname, '..', '..', '..', 'database', 'lms_mysql_schema.sql');
    const script = fs.readFileSync(schemaPath, 'utf8');

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || process.env.DB_SERVER || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true,
    });

    try {
        await connection.query(script);
        console.log('✅ Schema migration completed successfully!');

        const database = process.env.DB_NAME || 'LMS';

        const [tables] = await connection.query(
            `SELECT TABLE_NAME
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = ?
             ORDER BY TABLE_NAME`,
            [database],
        );
        console.log(`\nTables in ${database}:`);
        (tables as Array<{ TABLE_NAME: string }>).forEach((row) => console.log(` - ${row.TABLE_NAME}`));

        const [departments] = await connection.query(
            `SELECT id, code, name FROM \`${database}\`.ems_departments ORDER BY id`,
        );
        console.log('\nSeeded Departments:', departments);

        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

runMigration();
