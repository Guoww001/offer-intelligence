-- Optional DBA preparation for explicit Agent conversation log uploads.
-- Agent 对话日志上传表，可由 DBA 预先创建。未执行此脚本。
CREATE TABLE IF NOT EXISTS cnpscy_oi_agent_debug_cases (
  caseId CHAR(36) NOT NULL PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
