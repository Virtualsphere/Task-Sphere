// Creates the database (if missing) and all tables. Run: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const dbName = process.env.DB_NAME || 'pm_tool';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);

  // v2 upgrade: space chat messages get a "kind" (text | meeting | huddle)
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'kind'`, [dbName]);
  if (!cols.length) {
    await conn.query(`ALTER TABLE messages ADD COLUMN kind ENUM('text','meeting','huddle','file') NOT NULL DEFAULT 'text' AFTER user_id`);
  }

  // v3 upgrade: chat messages (personal/group and space) can be file attachments
  const columnInfo = async (table, column) => {
    const [[row]] = await conn.query(
      'SELECT COLUMN_TYPE AS t, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [dbName, table, column]);
    return row;
  };
  for (const table of ['direct_messages', 'messages']) {
    const kind = await columnInfo(table, 'kind');
    if (kind && !kind.t.includes("'file'")) {
      await conn.query(`ALTER TABLE ${table} MODIFY COLUMN kind ENUM('text','meeting','huddle','file') NOT NULL DEFAULT 'text'`);
    }
  }
  // Early version of chat_attachments was for personal chats only: add space chats
  if (!(await columnInfo('chat_attachments', 'space_id'))) {
    await conn.query(`ALTER TABLE chat_attachments
      MODIFY COLUMN conversation_id INT NULL,
      ADD COLUMN space_id INT NULL AFTER conversation_id,
      ADD INDEX idx_att_space (space_id),
      ADD CONSTRAINT fk_att_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE`);
  }
  await conn.end();
  console.log(`Database "${dbName}" is ready.`);
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
