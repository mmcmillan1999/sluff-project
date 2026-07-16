// backend/src/data/createTables.js
// This file creates the necessary database tables and types for the application

const createDbTables = async (pool) => {
    const client = await pool.connect();
    // node-postgres transactions are connection-scoped. Keep every migration
    // statement on this checked-out client rather than hopping through
    // pool.query(), which can silently split BEGIN/COMMIT across sessions.
    pool = client;
    let transactionOpen = false;
    try {
        await pool.query('BEGIN');
        transactionOpen = true;

        await pool.query(`
            DO $$ BEGIN
                CREATE TYPE transaction_type_enum AS ENUM (
                    'buy_in', 
                    'win_payout', 
                    'forfeit_loss', 
                    'forfeit_payout',
                    'admin_adjustment',
                    'free_token_mercy',
                    'wash_payout',
                    'abandoned_refund'
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
                is_admin BOOLEAN DEFAULT FALSE,
                is_bot BOOLEAN NOT NULL DEFAULT FALSE
            );
        `);
        
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE");
        await pool.query("ALTER TABLE users ALTER COLUMN is_bot SET DEFAULT FALSE");
        await pool.query("UPDATE users SET is_bot = FALSE WHERE is_bot IS NULL");
        await pool.query("ALTER TABLE users ALTER COLUMN is_bot SET NOT NULL");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMP WITH TIME ZONE");
        
        // --- NEW: Add columns for password recovery ---
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_expires TIMESTAMP WITH TIME ZONE");
        // Tutorial progress is durable across browsers/devices. Version 0 means
        // the player has not completed or skipped a guided tutorial; the active
        // version lets an interrupted tutorial resume without marking it done.
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_version INTEGER NOT NULL DEFAULT 0");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_active_version INTEGER NOT NULL DEFAULT 0");

        // Seasons are deliberately separate from the lifetime counters on
        // users. A rollover starts a new competitive scoreboard without
        // changing a wallet or erasing a player's career record.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS seasons (
                season_id SERIAL PRIMARY KEY,
                season_number INTEGER NOT NULL UNIQUE,
                slug VARCHAR(80) NOT NULL UNIQUE,
                display_name VARCHAR(80) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'finalized')),
                ranking_method VARCHAR(40) NOT NULL
                    CHECK (ranking_method IN ('wallet_balance', 'game_token_net')),
                rules JSONB NOT NULL DEFAULT '{}'::jsonb,
                starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP WITH TIME ZONE,
                finalized_at TIMESTAMP WITH TIME ZONE,
                final_standings_hash CHAR(64),
                final_player_count INTEGER CHECK (final_player_count >= 0),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS final_standings_hash CHAR(64)");
        await pool.query("ALTER TABLE seasons ADD COLUMN IF NOT EXISTS final_player_count INTEGER");
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_one_active
            ON seasons ((status))
            WHERE status = 'active'
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_history (
                game_id SERIAL PRIMARY KEY,
                table_id VARCHAR(50),
                theme VARCHAR(50),
                player_count INTEGER,
                start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                heartbeat_owner_id VARCHAR(128),
                recovery_eligible BOOLEAN NOT NULL DEFAULT TRUE,
                end_time TIMESTAMP WITH TIME ZONE,
                outcome TEXT,
                reconciliation_status VARCHAR(50),
                reconciled_at TIMESTAMP WITH TIME ZONE,
                reconciled_by VARCHAR(128)
            );
        `);
        await pool.query(`
            INSERT INTO seasons
                (season_number, slug, display_name, status, ranking_method, rules, starts_at)
            SELECT
                1,
                'alpha-season-1',
                'Alpha Season 1',
                'active',
                'wallet_balance',
                '{"minimumSettledGames": 0, "ranking": "wallet_balance"}'::jsonb,
                COALESCE((SELECT MIN(start_time) FROM game_history), CURRENT_TIMESTAMP)
            WHERE NOT EXISTS (SELECT 1 FROM seasons)
            ON CONFLICT (season_number) DO NOTHING
        `);

        // Add without a default first so rows from an older schema remain NULL
        // until the final migration statement. Their recovery grace therefore
        // starts at migration completion, not at transaction start.
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE");
        await pool.query("ALTER TABLE game_history ALTER COLUMN last_activity_at SET DEFAULT CURRENT_TIMESTAMP");
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS heartbeat_owner_id VARCHAR(128)");
        // Legacy game rows cannot be distinguished reliably from completed
        // losses because older code often left both as "In Progress" with only
        // a buy-in in the ledger. Keep those rows NULL (quarantined), while the
        // TRUE default makes every game created after this migration eligible
        // for the hardened crash-recovery path.
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS recovery_eligible BOOLEAN");
        await pool.query("ALTER TABLE game_history ALTER COLUMN recovery_eligible SET DEFAULT TRUE");
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR(50)");
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP WITH TIME ZONE");
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS reconciled_by VARCHAR(128)");
        await pool.query("ALTER TABLE game_history ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(season_id)");
        // Alpha Season 1 represents all history that predates seasons as well
        // as every game played before the first explicit rollover.
        await pool.query(`
            UPDATE game_history
            SET season_id = (
                SELECT season_id FROM seasons WHERE season_number = 1
            )
            WHERE season_id IS NULL
        `);
        await pool.query("ALTER TABLE game_history ALTER COLUMN season_id SET NOT NULL");
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_game_history_season
            ON game_history (season_id, game_id)
        `);
        // This trigger protects rolling deployments: an older application
        // process that omits season_id still joins the sole active season.
        await pool.query(`
            CREATE OR REPLACE FUNCTION assign_active_season_to_game()
            RETURNS trigger AS $$
            BEGIN
                IF NEW.season_id IS NULL THEN
                    SELECT season_id INTO NEW.season_id
                    FROM seasons
                    WHERE status = 'active';
                END IF;
                IF NEW.season_id IS NULL THEN
                    RAISE EXCEPTION 'No active season is available for a new game';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM seasons
                    WHERE season_id = NEW.season_id AND status = 'active'
                ) THEN
                    RAISE EXCEPTION 'New games must belong to the active season';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await pool.query('DROP TRIGGER IF EXISTS trg_game_history_active_season ON game_history');
        await pool.query(`
            CREATE TRIGGER trg_game_history_active_season
            BEFORE INSERT ON game_history
            FOR EACH ROW EXECUTE FUNCTION assign_active_season_to_game()
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_game_history_recovery_candidates
            ON game_history (last_activity_at, game_id)
            WHERE outcome = 'In Progress'
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                game_id INTEGER REFERENCES game_history(game_id) ON DELETE SET NULL,
                transaction_type transaction_type_enum NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                description TEXT,
                idempotency_key TEXT,
                transaction_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ensure transaction_time column exists (for existing databases)
        await pool.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP");
        // The first production schema called the event-time column `timestamp`.
        // When transaction_time was later added with a default, PostgreSQL gave
        // every pre-existing row the migration timestamp. Restore the original
        // event time only for clearly backfilled cohorts (two or more rows that
        // share a later transaction_time), while leaving both the legacy column
        // and every already-correct/new row untouched.
        await pool.query(`
            DO $migration$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'transactions'
                      AND column_name = 'timestamp'
                ) THEN
                    EXECUTE $repair$
                        UPDATE transactions AS target
                        SET transaction_time = target."timestamp"
                        WHERE target."timestamp" IS NOT NULL
                          AND (
                              target.transaction_time IS NULL
                              OR (
                                  target.transaction_time > target."timestamp"
                                  AND EXISTS (
                                      SELECT 1
                                      FROM transactions AS cohort
                                      WHERE cohort.transaction_id <> target.transaction_id
                                        AND cohort.transaction_time = target.transaction_time
                                        AND cohort."timestamp" IS NOT NULL
                                        AND cohort.transaction_time > cohort."timestamp"
                                  )
                              )
                          )
                    $repair$;
                END IF;
            END
            $migration$;
        `);
        await pool.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT");
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
            ON transactions (idempotency_key)
            WHERE idempotency_key IS NOT NULL
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_transactions_user_history
            ON transactions (user_id, transaction_id DESC)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_transactions_game_history
            ON transactions (game_id, transaction_id)
            WHERE game_id IS NOT NULL
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_transactions_mercy_history
            ON transactions (user_id, transaction_time DESC)
            WHERE transaction_type = 'free_token_mercy'
        `);

        // Records the one authoritative opening-wallet baseline for a season.
        // Wallets remain ledger-derived: the operation itself inserts normal
        // admin_adjustment rows, while this immutable marker makes retries
        // auditable and prevents the reset from being applied twice.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS season_wallet_reset_operations (
                operation_key VARCHAR(100) PRIMARY KEY,
                season_id INTEGER NOT NULL UNIQUE REFERENCES seasons(season_id),
                target_tokens DECIMAL(10, 2) NOT NULL CHECK (target_tokens >= 0),
                preview_hash CHAR(64) NOT NULL,
                account_count INTEGER NOT NULL CHECK (account_count >= 0),
                changed_account_count INTEGER NOT NULL CHECK (changed_account_count >= 0),
                old_supply DECIMAL(14, 2) NOT NULL,
                new_supply DECIMAL(14, 2) NOT NULL,
                minted DECIMAL(14, 2) NOT NULL CHECK (minted >= 0),
                burned DECIMAL(14, 2) NOT NULL CHECK (burned >= 0),
                net_change DECIMAL(14, 2) NOT NULL,
                applied_by_user_id INTEGER,
                applied_by_username VARCHAR(50) NOT NULL,
                applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (changed_account_count <= account_count),
                CHECK (preview_hash ~ '^[a-f0-9]{64}$')
            )
        `);
        await pool.query(`
            CREATE OR REPLACE FUNCTION reject_wallet_reset_operation_mutation()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'Season wallet reset operations are immutable';
            END;
            $$ LANGUAGE plpgsql
        `);
        await pool.query('DROP TRIGGER IF EXISTS trg_wallet_reset_operations_immutable ON season_wallet_reset_operations');
        await pool.query(`
            CREATE TRIGGER trg_wallet_reset_operations_immutable
            BEFORE UPDATE OR DELETE ON season_wallet_reset_operations
            FOR EACH ROW EXECUTE FUNCTION reject_wallet_reset_operation_mutation()
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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_insurance_logs (
                log_id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES game_history(game_id) ON DELETE CASCADE,
                bot_name VARCHAR(50) NOT NULL,
                is_bidder BOOLEAN NOT NULL,
                bid_multiplier INTEGER NOT NULL,
                trick_number INTEGER NOT NULL,
                deal_executed BOOLEAN NOT NULL,
                bot_offer INTEGER NOT NULL,
                bidder_requirement INTEGER NOT NULL,
                actual_outcome INTEGER,
                hindsight_value INTEGER,
                saved_or_wasted INTEGER,
                game_phase VARCHAR(20),
                hand_strength INTEGER,
                current_score INTEGER,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_bot_insurance_logs_bot_name 
            ON bot_insurance_logs(bot_name);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_bot_insurance_logs_created_at 
            ON bot_insurance_logs(created_at);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_strategy_adjustments (
                adjustment_id SERIAL PRIMARY KEY,
                bot_name VARCHAR(50) NOT NULL,
                strategy_type VARCHAR(50) NOT NULL,
                trick_range VARCHAR(20) NOT NULL,
                adjustment_factor DECIMAL(5,3) NOT NULL,
                reason TEXT,
                performance_metric DECIMAL(10,2),
                games_analyzed INTEGER,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS season_player_stats (
                season_id INTEGER NOT NULL REFERENCES seasons(season_id),
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
                losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
                washes INTEGER NOT NULL DEFAULT 0 CHECK (washes >= 0),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (season_id, user_id)
            )
        `);
        // While Season 1 is active, career stats and Season 1 stats are the
        // same thing. Never run this update after the season is finalized.
        await pool.query(`
            INSERT INTO season_player_stats (season_id, user_id, wins, losses, washes)
            SELECT s.season_id, u.id, u.wins, u.losses, u.washes
            FROM seasons s
            CROSS JOIN users u
            WHERE s.season_number = 1 AND s.status = 'active'
            ON CONFLICT (season_id, user_id) DO UPDATE
            SET wins = EXCLUDED.wins,
                losses = EXCLUDED.losses,
                washes = EXCLUDED.washes,
                updated_at = CURRENT_TIMESTAMP
        `);

        // Snapshot rows intentionally retain only a plain source_user_id, not
        // a foreign key. Account deletion must never rewrite or block a legacy
        // season's immutable standings or display name.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS season_standings_snapshots (
                season_id INTEGER NOT NULL REFERENCES seasons(season_id),
                position INTEGER NOT NULL CHECK (position > 0),
                rank INTEGER CHECK (rank > 0),
                source_user_id INTEGER,
                display_name VARCHAR(50) NOT NULL,
                wins INTEGER NOT NULL CHECK (wins >= 0),
                losses INTEGER NOT NULL CHECK (losses >= 0),
                washes INTEGER NOT NULL CHECK (washes >= 0),
                games_played INTEGER NOT NULL CHECK (games_played >= 0),
                eligible BOOLEAN NOT NULL,
                ranking_tokens DECIMAL(14, 2) NOT NULL,
                wallet_tokens DECIMAL(14, 2) NOT NULL,
                snapshotted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (season_id, position),
                UNIQUE (season_id, source_user_id)
            )
        `);
        await pool.query(`
            CREATE OR REPLACE FUNCTION reject_finalized_season_mutation()
            RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Seasons cannot be deleted';
                END IF;
                IF OLD.status = 'finalized' THEN
                    RAISE EXCEPTION 'Finalized seasons are immutable';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await pool.query('DROP TRIGGER IF EXISTS trg_seasons_immutable ON seasons');
        await pool.query(`
            CREATE TRIGGER trg_seasons_immutable
            BEFORE UPDATE OR DELETE ON seasons
            FOR EACH ROW EXECUTE FUNCTION reject_finalized_season_mutation()
        `);
        await pool.query(`
            CREATE OR REPLACE FUNCTION reject_standings_snapshot_mutation()
            RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM seasons
                        WHERE season_id = NEW.season_id AND status = 'active'
                    ) THEN
                        RAISE EXCEPTION 'Final season standings are immutable';
                    END IF;
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION 'Final season standings are immutable';
            END;
            $$ LANGUAGE plpgsql
        `);
        await pool.query('DROP TRIGGER IF EXISTS trg_standings_snapshots_immutable ON season_standings_snapshots');
        await pool.query(`
            CREATE TRIGGER trg_standings_snapshots_immutable
            BEFORE INSERT OR UPDATE OR DELETE ON season_standings_snapshots
            FOR EACH ROW EXECUTE FUNCTION reject_standings_snapshot_mutation()
        `);

        // This must remain the final statement before COMMIT. clock_timestamp()
        // grants legacy/null rows a full grace window from migration completion,
        // while the predicate preserves every non-null heartbeat across deploys.
        await pool.query(`
            UPDATE game_history
            SET last_activity_at = clock_timestamp()
            WHERE last_activity_at IS NULL
        `);

        await pool.query('COMMIT');
        transactionOpen = false;
        // PostgreSQL requires a newly-added enum value to be committed before
        // it can be used. This idempotent upgrade therefore runs after the
        // schema transaction and before recovery can insert refund records.
        await pool.query("ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'abandoned_refund'");
        console.log("✅ Tables checked/created/altered successfully.");
    } catch (err) {
        if (transactionOpen) await pool.query('ROLLBACK');
        console.error("Error during table creation/modification:", err);
        throw err;
    } finally {
        client.release();
    }
};

module.exports = createDbTables;
