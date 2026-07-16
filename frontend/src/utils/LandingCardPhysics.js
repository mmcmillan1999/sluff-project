// frontend/src/utils/LandingCardPhysics.js
// Physics for the /claude landing-page hero cards.
//
// The drag model is a direct port of the in-game CardPhysicsEngine feel:
// the card hangs from the grabbed point like a pendulum (gravity torque
// toward the pivot-over-center equilibrium), finger movement applies torque
// via t = r x F, and release velocity comes from a short touch-history
// sample. The flight model differs from the game on purpose: instead of
// guiding the card toward a drop zone, thrown cards glide and spin freely
// across the viewport, bounce off its edges, and after a short flight
// wander back to their slot in the hero fan.

const MAX_TOUCH_HISTORY = 5;
const VELOCITY_SAMPLE_WINDOW_MS = 120; // only count movement right before release
const MAX_ANGULAR_VELOCITY = 15;       // rad/s, same cap as the game engine
const FINGER_INFLUENCE = 50.0 * 0.001; // game engine finger-torque scaling
const GRAVITY_STRENGTH = 2.0;          // game engine gravity-torque strength
const SPIN_DAMPING = 0.96;             // per-frame; thrown spin winds down in ~0.9s
const SPIN_ALIGN_THRESHOLD = 1.5;      // rad/s; below this, ease rotation home
const GLIDE_DAMPING = 0.992;           // per-frame linear air resistance in flight
const FLIGHT_SPIN_DAMPING = 0.985;     // per-frame angular air resistance in flight
const RESTITUTION = 0.7;               // viewport-edge bounce
const MAX_THROW_SPEED = 2800;          // px/s
const MIN_THROW_SPEED = 100;           // px/s; below this a release skips flight
const MAX_FLIGHT_TIME = 2.4;           // s of free flight before heading home
const MIN_FLIGHT_TIME = 0.7;           // s; don't head home before this
const FLIGHT_SPENT_SPEED = 60;         // px/s; flight is over once this slow
const RETURN_SMOOTH_TIME = 0.8;        // s; lazy wander back to the fan
const RETURN_ROT_SMOOTH_TIME = 0.3;    // s; rotation ease once spin has bled off
const GRAB_SCALE = 1.06;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeAngle = (angle) => {
    let a = angle;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
};

const rotateVec = (x, y, angle) => ({
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
});

// Critically-damped spring (same shape as the game engine's smoothDamp).
const smoothDamp = (current, target, velObj, key, smoothTime, dt) => {
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = (velObj[key] + omega * change) * dt;
    velObj[key] = (velObj[key] - omega * temp) * exp;
    return target + (change + temp) * exp;
};

class LandingCardPhysics {
    constructor() {
        this.cards = new Map();     // element -> card state
        this.byPointer = new Map(); // pointerId -> card state
        this.raf = null;
        this.lastTimestamp = 0;
        this.tick = this.tick.bind(this);
    }

    // slotElement stays in normal flow and marks where the card lives;
    // the card itself goes position:fixed while it is being thrown around.
    register(element, slotElement) {
        const card = {
            element,
            slot: slotElement,
            state: 'home', // home | drag | flight | return
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            rotation: 0,
            angularVelocity: 0,
            scale: 1,
            width: 0,
            height: 0,
            pivot: { x: 0, y: 0 },       // grab point in unrotated card coords
            homeOffset: { x: 0, y: 0 },  // card center relative to slot center
            homeRotation: 0,
            touchPoint: null,
            lastTouchPoint: null,
            touchHistory: [],
            flightTime: 0,
            settleVel: { x: 0, y: 0, r: 0 },
            aligning: false,
            pointerId: null,
        };

        const onDown = (event) => this.grab(card, event);
        const onMove = (event) => {
            if (this.byPointer.get(event.pointerId) !== card || card.state !== 'drag') return;
            card.touchPoint = { x: event.clientX, y: event.clientY };
            this.addTouchPoint(card, event.clientX, event.clientY);
        };
        const onUp = (event) => {
            if (this.byPointer.get(event.pointerId) !== card) return;
            this.release(card, event);
        };

        element.addEventListener('pointerdown', onDown);
        element.addEventListener('pointermove', onMove);
        element.addEventListener('pointerup', onUp);
        element.addEventListener('pointercancel', onUp);

        card.dispose = () => {
            element.removeEventListener('pointerdown', onDown);
            element.removeEventListener('pointermove', onMove);
            element.removeEventListener('pointerup', onUp);
            element.removeEventListener('pointercancel', onUp);
        };

        this.cards.set(element, card);
    }

    grab(card, event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (card.state === 'drag') return;

        const el = card.element;
        if (card.state === 'home') {
            // Capture the exact CSS fan pose before taking over the transform.
            const rect = el.getBoundingClientRect();
            const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            card.rotation = Math.atan2(matrix.b, matrix.a);
            card.homeRotation = card.rotation;
            card.width = el.offsetWidth;
            card.height = el.offsetHeight;
            card.position = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            const slotRect = card.slot.getBoundingClientRect();
            card.homeOffset = {
                x: card.position.x - (slotRect.left + slotRect.width / 2),
                y: card.position.y - (slotRect.top + slotRect.height / 2),
            };
            // Kill the entrance animation permanently so restoring inline
            // styles later can't replay it.
            el.style.animation = 'none';
            el.style.width = card.width + 'px';
            el.style.height = card.height + 'px';
            el.classList.add('cl-card-live');
        }

        const grabPoint = { x: event.clientX, y: event.clientY };
        const local = rotateVec(
            grabPoint.x - card.position.x,
            grabPoint.y - card.position.y,
            -card.rotation
        );
        card.pivot = {
            x: clamp(local.x, -card.width / 2, card.width / 2),
            y: clamp(local.y, -card.height / 2, card.height / 2),
        };
        card.state = 'drag';
        card.aligning = false;
        card.touchPoint = grabPoint;
        card.lastTouchPoint = null;
        card.touchHistory = [{ x: grabPoint.x, y: grabPoint.y, timestamp: performance.now() }];
        card.velocity = { x: 0, y: 0 };
        card.pointerId = event.pointerId;
        this.byPointer.set(event.pointerId, card);
        try {
            el.setPointerCapture(event.pointerId);
        } catch (err) {
            // Pointer may already be gone (e.g. synthetic events in tests).
        }
        event.preventDefault();
        this.applyTransform(card);
        this.ensureLoop();
    }

    release(card, event) {
        this.byPointer.delete(event.pointerId);
        if (card.element.hasPointerCapture && card.element.hasPointerCapture(event.pointerId)) {
            card.element.releasePointerCapture(event.pointerId);
        }
        card.pointerId = null;
        if (card.state !== 'drag') return;

        let velocity = this.sampleVelocity(card);
        const speed = Math.hypot(velocity.x, velocity.y);
        if (speed > MAX_THROW_SPEED) {
            const k = MAX_THROW_SPEED / speed;
            velocity = { x: velocity.x * k, y: velocity.y * k };
        }
        card.velocity = velocity;
        card.flightTime = 0;
        card.settleVel = { x: 0, y: 0, r: 0 };
        card.aligning = false;
        card.state = speed < MIN_THROW_SPEED ? 'return' : 'flight';
        this.ensureLoop();
    }

    addTouchPoint(card, x, y) {
        card.touchHistory.push({ x, y, timestamp: performance.now() });
        if (card.touchHistory.length > MAX_TOUCH_HISTORY) {
            card.touchHistory.shift();
        }
    }

    sampleVelocity(card) {
        const now = performance.now();
        const recent = card.touchHistory.filter((p) => now - p.timestamp < VELOCITY_SAMPLE_WINDOW_MS);
        if (recent.length < 2) return { x: 0, y: 0 };
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = (last.timestamp - first.timestamp) / 1000;
        if (dt <= 0) return { x: 0, y: 0 };
        return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    }

    // --- per-frame updates -------------------------------------------------

    updateDrag(card, dt) {
        // Pendulum grab, ported from CardPhysicsEngine.updateDragPhysics:
        // the card rests when its center of mass hangs below the pivot.
        const p = card.pivot;
        const equilibrium = Math.atan2(p.x, p.y) + Math.PI;
        const angleDiff = normalizeAngle(equilibrium - card.rotation);

        let fingerTorque = 0;
        let fingerMoving = false;
        if (card.lastTouchPoint && dt > 0) {
            const dx = card.touchPoint.x - card.lastTouchPoint.x;
            const dy = card.touchPoint.y - card.lastTouchPoint.y;
            if (Math.hypot(dx, dy) > 0.1) {
                fingerMoving = true;
                const torque = p.x * (dy / dt) - p.y * (dx / dt); // t = r x F
                fingerTorque = torque * FINGER_INFLUENCE;
            }
        }
        card.lastTouchPoint = { ...card.touchPoint };

        const gravityTorque = Math.sin(angleDiff) * GRAVITY_STRENGTH * (fingerMoving ? 0.3 : 1.0);
        card.angularVelocity += (gravityTorque + fingerTorque) * dt;
        const damping = fingerMoving ? 0.98 : (Math.abs(angleDiff) > 0.1 ? 0.95 : 0.90);
        card.angularVelocity *= damping;
        card.angularVelocity = clamp(card.angularVelocity, -MAX_ANGULAR_VELOCITY, MAX_ANGULAR_VELOCITY);
        card.rotation += card.angularVelocity * dt;

        // Keep the grabbed point locked under the finger.
        const world = rotateVec(card.pivot.x, card.pivot.y, card.rotation);
        card.position.x = card.touchPoint.x - world.x;
        card.position.y = card.touchPoint.y - world.y;

        card.scale = Math.min(card.scale + 0.02, GRAB_SCALE);
    }

    updateFlight(card, dt) {
        card.flightTime += dt;
        card.position.x += card.velocity.x * dt;
        card.position.y += card.velocity.y * dt;

        const frames = dt * 60;
        const glide = Math.pow(GLIDE_DAMPING, frames);
        card.velocity.x *= glide;
        card.velocity.y *= glide;
        card.rotation += card.angularVelocity * dt;
        card.angularVelocity *= Math.pow(FLIGHT_SPIN_DAMPING, frames);
        card.scale += (1 - card.scale) * Math.min(1, dt * 4);

        // Bounce off the viewport edges so cards stay on the page. Wall hits
        // trade a little spin for the tangential speed, like a real card.
        const margin = Math.hypot(card.width, card.height) / 2;
        if (card.position.x < margin && card.velocity.x < 0) {
            card.position.x = margin;
            card.velocity.x *= -RESTITUTION;
            card.angularVelocity = card.angularVelocity * 0.6 - card.velocity.y * 0.003;
        } else if (card.position.x > window.innerWidth - margin && card.velocity.x > 0) {
            card.position.x = window.innerWidth - margin;
            card.velocity.x *= -RESTITUTION;
            card.angularVelocity = card.angularVelocity * 0.6 + card.velocity.y * 0.003;
        }
        if (card.position.y < margin && card.velocity.y < 0) {
            card.position.y = margin;
            card.velocity.y *= -RESTITUTION;
            card.angularVelocity = card.angularVelocity * 0.6 + card.velocity.x * 0.003;
        } else if (card.position.y > window.innerHeight - margin && card.velocity.y > 0) {
            card.position.y = window.innerHeight - margin;
            card.velocity.y *= -RESTITUTION;
            card.angularVelocity = card.angularVelocity * 0.6 - card.velocity.x * 0.003;
        }

        const speed = Math.hypot(card.velocity.x, card.velocity.y);
        if (card.flightTime > MAX_FLIGHT_TIME
            || (card.flightTime > MIN_FLIGHT_TIME && speed < FLIGHT_SPENT_SPEED)) {
            card.state = 'return';
            card.settleVel = { x: 0, y: 0, r: 0 };
            card.aligning = false;
        }
    }

    updateReturn(card, dt) {
        // Home is measured off the slot every frame, so scrolling or resizing
        // mid-return still lands the card in the right place.
        const slotRect = card.slot.getBoundingClientRect();
        const targetX = slotRect.left + slotRect.width / 2 + card.homeOffset.x;
        const targetY = slotRect.top + slotRect.height / 2 + card.homeOffset.y;
        card.position.x = smoothDamp(card.position.x, targetX, card.settleVel, 'x', RETURN_SMOOTH_TIME, dt);
        card.position.y = smoothDamp(card.position.y, targetY, card.settleVel, 'y', RETURN_SMOOTH_TIME, dt);
        card.scale += (1 - card.scale) * Math.min(1, dt * 6);

        // Let leftover spin bleed off before aligning, same as the game's dock.
        if (!card.aligning && Math.abs(card.angularVelocity) > SPIN_ALIGN_THRESHOLD) {
            card.rotation += card.angularVelocity * dt;
            card.angularVelocity *= Math.pow(SPIN_DAMPING, dt * 60);
        } else {
            if (!card.aligning) {
                card.aligning = true;
                card.angularVelocity = 0;
                card.rotation = card.homeRotation + normalizeAngle(card.rotation - card.homeRotation);
            }
            card.rotation = smoothDamp(card.rotation, card.homeRotation, card.settleVel, 'r', RETURN_ROT_SMOOTH_TIME, dt);
        }

        const dist = Math.hypot(card.position.x - targetX, card.position.y - targetY);
        if (dist < 1.2
            && Math.hypot(card.settleVel.x, card.settleVel.y) < 20
            && card.aligning
            && Math.abs(card.rotation - card.homeRotation) < 0.02) {
            this.settleHome(card);
        }
    }

    settleHome(card) {
        card.state = 'home';
        card.aligning = false;
        card.scale = 1;
        card.angularVelocity = 0;
        const style = card.element.style;
        card.element.classList.remove('cl-card-live');
        style.transform = '';
        style.width = '';
        style.height = '';
    }

    applyTransform(card) {
        card.element.style.transform =
            'translate3d(' + (card.position.x - card.width / 2) + 'px, '
            + (card.position.y - card.height / 2) + 'px, 0) '
            + 'rotate(' + card.rotation + 'rad) scale(' + card.scale + ')';
    }

    ensureLoop() {
        if (this.raf === null) {
            this.lastTimestamp = 0;
            this.raf = requestAnimationFrame(this.tick);
        }
    }

    tick(timestamp) {
        this.raf = null;
        if (this.lastTimestamp === 0) {
            this.lastTimestamp = timestamp;
            this.raf = requestAnimationFrame(this.tick);
            return;
        }
        const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 1 / 30);
        this.lastTimestamp = timestamp;

        let active = 0;
        this.cards.forEach((card) => {
            if (card.state === 'home') return;
            if (card.state === 'drag') this.updateDrag(card, dt);
            else if (card.state === 'flight') this.updateFlight(card, dt);
            else if (card.state === 'return') this.updateReturn(card, dt);
            if (card.state !== 'home') {
                active += 1;
                this.applyTransform(card);
            }
        });

        if (active > 0) {
            this.raf = requestAnimationFrame(this.tick);
        }
    }

    destroy() {
        if (this.raf !== null) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
        this.cards.forEach((card) => {
            card.dispose();
            if (card.state !== 'home') this.settleHome(card);
        });
        this.cards.clear();
        this.byPointer.clear();
    }
}

export default LandingCardPhysics;
