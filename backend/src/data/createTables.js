// backend/src/data/createTables.js
// This file creates the necessary database tables and types for the application

const createDbTables = async (pool) => {
    try {
        await pool.query('BEGIN');

        await pool.query(`
            DO $$ BEGIN
                CREATE TYPE transaction_type_enum AS ENUM (
                    'buy_in', 
                    'win_payout', 
                    'forfeit_loss', 
                    'forfeit_payout',
                    'admin_adjustment',
                    'free_token_mercy',
                    'wash_payout'
                );
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);

        await pool.query(`
            DO $$ BEGIN
                CREATE TYPE user_role_enum AS ENUM ('player', 'admin');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);

        await pool.query(`
            DO $$ BEGIN
                CREATE TYPE feedback_status_enum AS ENUM ('new', 'in_progress', 'resolved', 'wont_fix');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);
        await pool.query("ALTER TYPE feedback_status_enum ADD VALUE IF NOT EXISTS 'hidden'");


        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                washes INTEGER DEFAULT 0,
                is_admin BOOLEAN DEFAULT FALSE
            );
        `);
        
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMP WITH TIME ZONE");
        
        // --- NEW: Add columns for password recovery ---
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_expires TIMESTAMP WITH TIME ZONE");


        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_history (
                game_id SERIAL PRIMARY KEY,
                table_id VARCHAR(50),
                theme VARCHAR(50),
                player_count INTEGER,
                start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP WITH TIME ZONE,
                outcome TEXT
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                game_id INTEGER REFERENCES game_history(game_id) ON DELETE SET NULL,
                transaction_type transaction_type_enum NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                description TEXT,
                transaction_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS feedback (
                feedback_id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                username VARCHAR(50),
                submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                feedback_text TEXT NOT NULL,
                table_id VARCHAR(50),
                game_state_json JSONB,
                status feedback_status_enum DEFAULT 'new'
            );
        `);
        
        await pool.query("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_response TEXT");
        await pool.query("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT");
        await pool.query("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS last_updated_by_admin_at TIMESTAMP WITH TIME ZONE");


        await pool.query(`
            CREATE TABLE IF NOT EXISTS lobby_chat_messages (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                username VARCHAR(50),
                message TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query('COMMIT');
        console.log("✅ Tables checked/created/altered successfully.");
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Error during table creation/modification:", err);
        throw err;
    }
};

module.exports = createDbTables;