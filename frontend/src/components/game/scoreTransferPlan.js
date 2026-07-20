const CENTS_PER_POINT = 100;

const emptyPlan = () => ({ transfers: [], balanced: false });

const toCents = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER / CENTS_PER_POINT) return null;

    const absoluteValue = Math.abs(value);
    const rounded = Math.round(
        (absoluteValue + (Number.EPSILON * absoluteValue)) * CENTS_PER_POINT,
    );
    return value < 0 ? -rounded : rounded;
};

const orderedParticipantNames = (pointChanges, playerOrder) => {
    const changeNames = Object.keys(pointChanges);
    const changeNameSet = new Set(changeNames);
    const seen = new Set();
    const names = [];

    const include = (name) => {
        if (!changeNameSet.has(name) || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    };

    playerOrder.forEach(include);
    changeNames.forEach(include);
    return names;
};

/**
 * Turn a zero-sum round score into a deterministic series of chip payments.
 *
 * The plan is presentation-only: it pairs debtors with creditors without
 * changing the authoritative round scores. Values are normalized to cents so
 * floating-point noise cannot produce a stray final chip.
 */
export const buildScoreTransferPlan = ({ pointChanges, playerOrder = [] } = {}) => {
    if (!pointChanges
        || typeof pointChanges !== 'object'
        || Array.isArray(pointChanges)
        || !Array.isArray(playerOrder)) {
        return emptyPlan();
    }

    const changeNames = Object.keys(pointChanges);
    if (changeNames.length === 0
        || playerOrder.some(name => typeof name !== 'string')) {
        return emptyPlan();
    }

    const changesInCents = {};
    for (const name of changeNames) {
        const cents = toCents(pointChanges[name]);
        if (!name || cents === null) return emptyPlan();
        changesInCents[name] = cents;
    }

    const participantNames = orderedParticipantNames(pointChanges, playerOrder);
    const debtors = participantNames
        .filter(name => changesInCents[name] < 0)
        .map(name => ({ name, remaining: -changesInCents[name] }));
    const creditors = participantNames
        .filter(name => changesInCents[name] > 0)
        .map(name => ({ name, remaining: changesInCents[name] }));

    const totalDebt = debtors.reduce((total, entry) => total + entry.remaining, 0);
    const totalCredit = creditors.reduce((total, entry) => total + entry.remaining, 0);
    if (!Number.isSafeInteger(totalDebt)
        || !Number.isSafeInteger(totalCredit)
        || totalDebt !== totalCredit) {
        return emptyPlan();
    }

    const transfers = [];
    let debtorIndex = 0;
    let creditorIndex = 0;

    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
        const debtor = debtors[debtorIndex];
        const creditor = creditors[creditorIndex];
        const amountInCents = Math.min(debtor.remaining, creditor.remaining);

        if (amountInCents > 0) {
            transfers.push({
                id: `score-transfer-${transfers.length + 1}`,
                from: debtor.name,
                to: creditor.name,
                amount: amountInCents / CENTS_PER_POINT,
            });
        }

        debtor.remaining -= amountInCents;
        creditor.remaining -= amountInCents;
        if (debtor.remaining === 0) debtorIndex += 1;
        if (creditor.remaining === 0) creditorIndex += 1;
    }

    return { transfers, balanced: true };
};
