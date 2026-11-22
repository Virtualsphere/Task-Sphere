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
  // v4 upgrade: space chat replies (quote a message, like WhatsApp)
  if (!(await columnInfo('messages', 'reply_to_id'))) {
    await conn.query(`ALTER TABLE messages
      ADD COLUMN reply_to_id INT NULL AFTER body,
      ADD CONSTRAINT fk_msg_reply FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL`);
  }
  // v5 upgrade: subtasks get a description
  if (!(await columnInfo('subtasks', 'description'))) {
    await conn.query('ALTER TABLE subtasks ADD COLUMN description TEXT NULL AFTER title');
  }
  // v6 upgrade: "last seen" and delivered ticks (✓✓) in personal chats
  if (!(await columnInfo('users', 'last_seen_at'))) {
    await conn.query('ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP NULL');
  }
  if (!(await columnInfo('conversation_members', 'last_delivered_id'))) {
    await conn.query('ALTER TABLE conversation_members ADD COLUMN last_delivered_id INT NOT NULL DEFAULT 0 AFTER last_read_id');
    // Treat everything already read as delivered
    await conn.query('UPDATE conversation_members SET last_delivered_id = last_read_id');
  }
  // v7 upgrade: replies in personal / group chats
  if (!(await columnInfo('direct_messages', 'reply_to_id'))) {
    await conn.query(`ALTER TABLE direct_messages
      ADD COLUMN reply_to_id INT NULL AFTER body,
      ADD CONSTRAINT fk_dm_reply FOREIGN KEY (reply_to_id) REFERENCES direct_messages(id) ON DELETE SET NULL`);
  }
  await conn.end();
  console.log(`Database "${dbName}" is ready.`);
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
