/**
 * Small SQL translation helpers that let SQL Server style queries run on MySQL.
 *
 * Kept side-effect free so they can be unit-tested without opening a DB connection.
 */

export interface SqlType {
    __sqlType: string;
    size?: unknown;
}

export const sqlType = (name: string, size?: unknown): SqlType => ({ __sqlType: name, size });

export interface OutputInfo {
    sql: string;
    columns: string | null;
    kind: 'insert' | 'update' | null;
    table: string | null;
    whereClause: string | null;
}

const PRIMARY_KEYS: Record<string, string> = {
    students: 'student_id',
    trainers: 'trainer_id',
};

export function getPrimaryKey(table: string): string {
    return PRIMARY_KEYS[table.toLowerCase()] ?? 'id';
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function toMysqlDateTime(value: Date): string {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} `
        + `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function normalizeValue(sqlType: SqlType | undefined, value: unknown): unknown {
    if (value === undefined || value === null) {
        return null;
    }

    const kind = sqlType?.__sqlType;

    if (kind === 'bit') {
        return value ? 1 : 0;
    }

    if (kind === 'date') {
        if (value instanceof Date) {
            return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
        }
        if (typeof value === 'string') {
            return value.length >= 10 ? value.slice(0, 10) : value;
        }
        return value;
    }

    if (kind === 'datetime2') {
        if (value instanceof Date) {
            return toMysqlDateTime(value);
        }
        if (typeof value === 'string') {
            return value
                .replace('T', ' ')
                .replace(/Z$/i, '')
                .replace(/\.\d+$/, '')
                .slice(0, 19);
        }
    }

    return value;
}

export function bindParams(command: string, params: Map<string, unknown>): { sql: string; values: unknown[] } {
    const values: unknown[] = [];

    const text = command.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
        if (!params.has(name)) {
            throw new Error(`SQL parameter @${name} was not provided`);
        }
        values.push(params.get(name));
        return '?';
    });

    return { sql: text, values };
}

export function extractOutput(command: string): OutputInfo {
    const match = command.match(/^[ \t]*OUTPUT[ \t]+INSERTED\.([^\r\n;]+?);?[ \t]*$/im);
    if (!match) {
        return { sql: command, columns: null, kind: null, table: null, whereClause: null };
    }

    const columns = match[1].replace(/\bINSERTED\./gi, '').trim();
    const withoutOutput = command.replace(match[0], '');

    const insert = withoutOutput.match(/^\s*INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?/i);
    if (insert) {
        return { sql: withoutOutput, columns, kind: 'insert', table: insert[1], whereClause: null };
    }

    const update = withoutOutput.match(/^\s*UPDATE\s+`?([A-Za-z0-9_]+)`?/i);
    if (update) {
        const whereIndex = withoutOutput.search(/\bWHERE\b/i);
        const whereClause = whereIndex >= 0 ? withoutOutput.slice(whereIndex).trim() : '';
        return { sql: withoutOutput, columns, kind: 'update', table: update[1], whereClause };
    }

    return { sql: withoutOutput, columns: null, kind: null, table: null, whereClause: null };
}
