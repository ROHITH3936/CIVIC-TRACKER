-- Run once against the existing civic_tracker database.
USE civic_tracker;

-- Persistent, revocable login sessions. Only a SHA-256 token hash is stored.
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_auth_sessions_expiry (expires_at),
    INDEX idx_auth_sessions_user (user_id)
);

-- Citizen confirmation or dispute of an administrator's resolution claim.
CREATE TABLE IF NOT EXISTS resolution_reviews (
    review_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    issue_id INT NOT NULL,
    user_id INT NOT NULL,
    decision ENUM('CONFIRMED','DISPUTED') NOT NULL,
    reason VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_resolution_review_issue_user (issue_id, user_id),
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Keep this script safe to re-run. Expired sessions can be cleaned periodically.
DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP();
