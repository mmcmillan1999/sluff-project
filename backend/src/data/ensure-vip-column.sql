-- SQL script to ensure is_vip column exists and set all users as VIP

-- Add the is_vip column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT TRUE;

-- Set all existing users as VIP
UPDATE users SET is_vip = TRUE WHERE is_vip IS NULL OR is_vip = FALSE;

-- Verify the results
SELECT username, is_vip, tokens FROM users LIMIT 10;

-- To create a test non-VIP user (uncomment if needed):
-- UPDATE users SET is_vip = FALSE WHERE username = 'testuser';