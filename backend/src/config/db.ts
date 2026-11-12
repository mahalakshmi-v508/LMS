import dotenv from 'dotenv';
import mysql, { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import {
    bindParams,
    extractOutput,
    getPrimaryKey,
    normalizeValue,
    sqlType,
    type SqlType,
} from './sqlTranslator';

dotenv.config();

/**
 * MySQL connection + a thin mssql-compatible compatibility layer.
 *
 * The rest of the codebase was originally written for Microsoft SQL Server
 * (named `@param` placeholders, `OUTPUT INSERTED.*`, `pool.request().input()`).
 * This module keeps that same API but runs the queries against MySQL, so the
 * controllers do not have to be rewritten.
 *
 * Translations performed automatically:
 *   - `@name` placeholders -> `?` placeholders (values are bound in order)
 *   - `INSERT ... OUTPUT INSERTED.<cols> VALUES ...` -> INSERT + SELECT by LAST_INSERT_ID()
 *   - `UPDATE ... OUTPUT INSERTED.<cols> WHERE ...` -> UPDATE + SELECT using the same WHERE
 */

type Queryable = Pool | PoolConnection;

export interface QueryResult {
    recordset: any[];
    recordsets: any[][];
    rowsAffected: number[];
}

async function runQuery(conn: Queryable, command: string, params: Map<string, unknown>): Promise<QueryResult> {
    const output = extractOutput(command);
    const bound = bindParams(output.sql, params);
    const [result] = await conn.query(bound.sql, bound.values);

    if (output.columns && output.table) {
        const columns = output.columns === '*' ? '*' : output.columns;

        if (output.kind === 'insert') {
            const header = result as ResultSetHeader;
            const rowsAffected = header.affectedRows ?? 0;
            const pk = getPrimaryKey(output.table);

            if (!header.insertId) {
                return { recordset: [], recordsets: [], rowsAffected: [rowsAffected] };
            }

            const [rows] = await conn.query(
                `SELECT ${columns} FROM \`${output.table}\` WHERE \`${pk}\` = ?`,
                [header.insertId],
            );
            return { recordset: rows as any[], recordsets: [rows as any[]], rowsAffected: [rowsAffected] };
        }

        if (output.kind === 'update' && output.whereClause) {
            const selectBound = bindParams(
                `SELECT ${columns} FROM \`${output.table}\` ${output.whereClause}`,
                params,
            );
            const [rows] = await conn.query(selectBound.sql, selectBound.values);
            return {
                recordset: rows as any[],
                recordsets: [rows as any[]],
                rowsAffected: [(result as ResultSetHeader).affectedRows ?? 0],
            };
        }
    }

    if (Array.isArray(result)) {
        return { recordset: result as any[], recordsets: [result as any[]], rowsAffected: [result.length] };
    }

    const header = result as ResultSetHeader;
    return { recordset: [], recordsets: [], rowsAffected: [header.affectedRows ?? 0] };
}

export class Request {
    private readonly params = new Map<string, unknown>();

    constructor(private readonly conn: Queryable) { }

    input(name: string, sqlType?: SqlType, value?: unknown): this {
        // mssql also allows request.input(name, value)
        if (arguments.length === 2) {
            value = sqlType;
            sqlType = undefined;
        }

        this.params.set(name, normalizeValue(sqlType, value));
        return this;
    }

    async query(command: string): Promise<QueryResult> {
        return runQuery(this.conn, command, this.params);
    }
}

export class Transaction {
    private connection: PoolConnection | null = null;

    constructor(private readonly pool: Pool) { }

    async begin(): Promise<void> {
        this.connection = await this.pool.getConnection();
        await this.connection.beginTransaction();
    }

    request(): Request {
        if (!this.connection) {
            throw new Error('Transaction has not been started. Call begin() first.');
        }
        return new Request(this.connection);
    }

    async commit(): Promise<void> {
        if (!this.connection) {
            return;
        }
        try {
            await this.connection.commit();
        } finally {
            this.connection.release();
            this.connection = null;
        }
    }

    async rollback(): Promise<void> {
        if (!this.connection) {
            return;
        }
        try {
            await this.connection.rollback();
        } finally {
            this.connection.release();
            this.connection = null;
        }
    }
}

export class ConnectionPool {
    constructor(private readonly raw: Pool) { }

    async connect(): Promise<this> {
        const connection = await this.raw.getConnection();
        connection.release();
        return this;
    }

    request(): Request {
        return new Request(this.raw);
    }

    transaction(): Transaction {
        return new Transaction(this.raw);
    }

    getRawPool(): Pool {
        return this.raw;
    }

    async close(): Promise<void> {
        await this.raw.end();
    }
}

export const sql = {
    MAX: 'MAX',
    Int: sqlType('int'),
    Bit: sqlType('bit'),
    Date: sqlType('date'),
    DateTime2: sqlType('datetime2'),
    Decimal: (precision?: number, scale?: number) => sqlType('decimal', [precision, scale]),
    VarChar: (size?: number | string) => sqlType('varchar', size),
    NVarChar: (size?: number | string) => sqlType('nvarchar', size),
    Transaction,
    ConnectionPool,
};

const rawPool = mysql.createPool({
    host: process.env.DB_HOST || process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'LMS',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'local',
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
});

export const poolPromise: Promise<ConnectionPool> = rawPool
    .getConnection()
    .then((connection) => {
        connection.release();
        console.log(`Connected to MySQL (${process.env.DB_NAME || 'LMS'}) successfully!`);
        return new ConnectionPool(rawPool);
    })
    .catch((err) => {
        console.error('Database connection failed: ', err);
        process.exit(1);
    });

export default sql;
