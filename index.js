import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const EXT_NAME = 'bipolar-tracker';

console.log(`[${EXT_NAME}] Script loaded, starting initialization...`);

// ============================
// DEFAULT STATE
// ============================

const DEFAULT_SETTINGS = {
    enabled: true,
    injectPrompt: true,
    parseSignals: true,
};

const DEFAULT_STATE = {
    phase: 'mania',
    phaseDay: 1,
    phaseMinDays: 14,
    ptsd: 0,
    aggression: 0,
    activeLock: null,
    lockLeft: 0,
    staticStreak: 0,
    lastRolls: [],
    lastResult: null,
    lastRollValue: null,
    aggressionJustExploded: false,
};

// ============================
// ROLL TABLES
// ============================

const MANIA_TABLE_BASE = [
    { min: 1, max: 4, id: 'void', label: 'VOID', color: '#666' },
    { min: 5, max: 8, id: 'adrenaline', label: 'ADRENALINE HUNGER', color: '#ff2d95' },
    { min: 9, max: 12, id: 'chaotic', label: 'CHAOTIC ACTIVITY', color: '#c8ff00' },
    { min: 13, max: 15, id: 'substance', label: 'SUBSTANCE CRAVING', color: '#ff9d3a' },
    { min: 16, max: 18, id: 'impulsive', label: 'IMPULSIVE BEHAVIOR', color: '#c678dd' },
    { min: 19, max: 20, id: 'wildcard', label: 'WILD CARD', color: '#e5c07b' },
];

const DEPRESSION_TABLE_BASE = [
    { min: 1, max: 7, id: 'static', label: 'STATIC', color: '#555' },
    { min: 8, max: 11, id: 'selfhate', label: 'SELF-HATRED WAVE', color: '#00fff7' },
    { min: 12, max: 14, id: 'indifference', label: 'TOTAL INDIFFERENCE', color: '#444' },
    { min: 15, max: 17, id: 'selfharm', label: 'SELF-HARM URGE', color: '#e06c75' },
    { min: 18, max: 20, id: 'wildcard', label: 'WILD CARD', color: '#e5c07b' },
];

function getManiaTable(ptsd) {
    if (ptsd >= 7) {
        return [
            { min: 1, max: 2, id: 'void', label: 'VOID', color: '#666' },
            { min: 3, max: 12, id: 'adrenaline', label: 'ADRENALINE HUNGER', color: '#ff2d95' },
            { min: 13, max: 14, id: 'chaotic', label: 'CHAOTIC ACTIVITY', color: '#c8ff00' },
            { min: 15, max: 16, id: 'substance', label: 'SUBSTANCE CRAVING', color: '#ff9d3a' },
            { min: 17, max: 18, id: 'impulsive', label: 'IMPULSIVE BEHAVIOR', color: '#c678dd' },
            { min: 19, max: 20, id: 'wildcard', label: 'WILD CARD', color: '#e5c07b' },
        ];
    }
    if (ptsd >= 4) {
        return [
            { min: 1, max: 3, id: 'void', label: 'VOID', color: '#666' },
            { min: 4, max: 10, id: 'adrenaline', label: 'ADRENALINE HUNGER', color: '#ff2d95' },
            { min: 11, max: 13, id: 'chaotic', label: 'CHAOTIC ACTIVITY', color: '#c8ff00' },
            { min: 14, max: 16, id: 'substance', label: 'SUBSTANCE CRAVING', color: '#ff9d3a' },
            { min: 17, max: 18, id: 'impulsive', label: 'IMPULSIVE BEHAVIOR', color: '#c678dd' },
            { min: 19, max: 20, id: 'wildcard', label: 'WILD CARD', color: '#e5c07b' },
        ];
    }
    return MANIA_TABLE_BASE;
}

function getDepressionTable(ptsd) {
    if (ptsd >= 7) {
        return [
            { min: 1, max: 4, id: 'static', label: 'STATIC', color: '#555' },
            { min: 5, max: 8, id: 'selfhate', label: 'SELF-HATRED WAVE', color: '#00fff7' },
            { min: 9, max: 11, id: 'indifference', label: 'TOTAL INDIFFERENCE', color: '#444' },
            { min: 12, max: 17, id: 'selfharm', label: 'SELF-HARM URGE', color: '#e06c75' },
            { min: 18, max: 20, id: 'wildcard', label: 'WILD CARD', color: '#e5c07b' },
        ];
    }
    if (ptsd >= 4) {
        return [
            { min: 1, max: 5, id: 'static', label: 'STATIC', color: '#555' },
            { min: 6, max: 10, id: 'selfhate', label: 'SELF-HATRED WAVE', color: '#00fff7' },
            { min: 11, max: 13, id: 'indifference', label: 'TOTAL INDIFFERENCE', color: '#444' },
            { min: 14, max: 17, id: 'selfharm', label: 'SELF-HARM URGE', color: '#e06c75' },
            { min: 18, max: 20, id: 'wildcard', label: 'WILD CARD', color: '#e5c07b' },
        ];
    }
    return DEPRESSION_TABLE_BASE;
}

// ============================
// DICE
// ============================

function rollD20(lastRolls) {
    let roll;
    let attempts = 0;
    do {
        roll = Math.floor(Math.random() * 20) + 1;
        attempts++;
    } while (lastRolls.length >= 3 && lastRolls.slice(-3).every(r => r === roll) && attempts < 100);
    return roll;
}

function resolveRoll(roll, table) {
    for (const entry of table) {
        if (roll >= entry.min && roll <= entry.max) return entry;
    }
    return table[0];
}

// ============================
// STATE
// ============================

function getState() {
    try {
        const context = getContext();
        const chatId = context.chatId;
        if (!chatId) return { ...DEFAULT_STATE };

        if (!extension_settings[EXT_NAME]) {
            extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS, chats: {} };
        }
        if (!extension_settings[EXT_NAME].chats) {
            extension_settings[EXT_NAME].chats = {};
        }
        if (!extension_settings[EXT_NAME].chats[chatId]) {
            extension_settings[EXT_NAME].chats[chatId] = { ...DEFAULT_STATE };
        }
        return extension_settings[EXT_NAME].chats[chatId];
    } catch (err) {
        console.error(`[${EXT_NAME}] getState error:`, err);
        return { ...DEFAULT_STATE };
    }
}

function saveState(state) {
    try {
        const context = getContext();
        const chatId = context.chatId;
        if (!chatId) return;
        extension_settings[EXT_NAME].chats[chatId] = state;
        saveSettingsDebounced();
    } catch (err) {
        console.error(`[${EXT_NAME}] saveState error:`, err);
    }
}

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS, chats: {} };
    }
    return extension_settings[EXT_NAME];
}

// ============================
// TICK
// ============================

function tick(signalPtsd = 0, signalAggr = 0) {
    const state = getState();
    const settings = getSettings();
    if (!settings.enabled) return state;

    state.ptsd = Math.min(10, Math.max(0, state.ptsd + signalPtsd));
    state.aggression = Math.min(10, Math.max(0, state.aggression + signalAggr));

    // Forced aggression at 7+
    if (state.aggression >= 7 && state.phase !== 'depression') {
        state.lastResult = { id: 'forced_aggression', label: 'FORCED AGGRESSION EXPLOSION', color: '#e06c75' };
        state.lastRollValue = '!!';
        state.aggression = 0;
        state.activeLock = 'tenderness';
        state.lockLeft = 2;
        state.aggressionJustExploded = true;
        saveState(state);
        return state;
    }

    // Active locks
    if (state.activeLock) {
        if (state.activeLock === 'tenderness') {
            state.lastResult = { id: 'tenderness', label: 'TENDERNESS / REMORSE', color: '#c678dd' };
            state.lastRollValue = '♡';
            state.lockLeft--;
            if (state.lockLeft <= 0) state.activeLock = null;
            saveState(state);
            return state;
        }
        if (state.activeLock === 'adrenaline') {
            state.lastResult = { id: 'adrenaline_locked', label: 'ADRENALINE LOCK (active)', color: '#ff2d95' };
            state.lastRollValue = '🔒';
            state.lockLeft--;
            if (state.lockLeft <= 0) state.activeLock = null;
            saveState(state);
            return state;
        }
        if (state.activeLock === 'depression_inertia') {
            state.lastResult = { id: 'static', label: 'STATIC (inertia holds)', color: '#555' };
            state.lastRollValue = '—';
            saveState(state);
            return state;
        }
    }

    // Roll
    const roll = rollD20(state.lastRolls);
    state.lastRolls.push(roll);
    if (state.lastRolls.length > 5) state.lastRolls.shift();
    state.lastRollValue = roll;

    let table;
    if (state.phase === 'mania' || state.phase === 'mixed') {
        table = getManiaTable(state.ptsd);
    } else {
        table = getDepressionTable(state.ptsd);
    }

    const result = resolveRoll(roll, table);
    state.lastResult = { ...result };

    // Post-roll
    if (state.phase === 'mania' || state.phase === 'mixed') {
        if (result.id === 'void') state.aggression = Math.min(10, state.aggression + 1);
        if (result.id === 'adrenaline') { state.activeLock = 'adrenaline'; state.lockLeft = 3; }
        if (result.id === 'impulsive') {
            state.lastResult.label = state.aggression >= 5
                ? 'IMPULSIVE BEHAVIOR (→ negative)'
                : 'IMPULSIVE BEHAVIOR (→ positive)';
        }
        state.staticStreak = 0;
    }

    if (state.phase === 'depression') {
        if (result.id === 'static') {
            state.staticStreak++;
            if (state.staticStreak >= 3) state.activeLock = 'depression_inertia';
        } else {
            state.staticStreak = 0;
            state.activeLock = null;
        }
    }

    state.aggressionJustExploded = false;
    saveState(state);
    return state;
}

// ============================
// SIGNAL PARSING
// ============================

function parseSignals(text) {
    let ptsd = 0, aggr = 0, dayAdvance = 0;
    let cleaned = text;

    const ptsdMatch = cleaned.match(/\[PTSD\+(\d+)\]/gi);
    if (ptsdMatch) {
        for (const m of ptsdMatch) ptsd += parseInt(m.match(/\d+/)[0]);
        cleaned = cleaned.replace(/\[PTSD\+\d+\]/gi, '');
    }

    const aggrMatch = cleaned.match(/\[AGGR\+(\d+)\]/gi);
    if (aggrMatch) {
        for (const m of aggrMatch) aggr += parseInt(m.match(/\d+/)[0]);
        cleaned = cleaned.replace(/\[AGGR\+\d+\]/gi, '');
    }

    const dayMatch = cleaned.match(/\[DAY\+(\d+)\]/gi);
    if (dayMatch) {
        for (const m of dayMatch) dayAdvance += parseInt(m.match(/\d+/)[0]);
        cleaned = cleaned.replace(/\[DAY\+\d+\]/gi, '');
    }

    const adrenSatisfied = /\[ADRENALINE_SATISFIED\]/gi.test(cleaned);
    cleaned = cleaned.replace(/\[ADRENALINE_SATISFIED\]/gi, '');

    const aggrOutburst = /\[AGGRESSION_OUTBURST\]/gi.test(cleaned);
    cleaned = cleaned.replace(/\[AGGRESSION_OUTBURST\]/gi, '');

    return { ptsd, aggr, dayAdvance, adrenSatisfied, aggrOutburst, cleaned };
}

// ============================
// DAY / PHASE
// ============================

function advanceDay(state, days = 1) {
    state.phaseDay += days;
    state.ptsd = Math.max(0, state.ptsd - days);
}

function transitionPhase(state, newPhase) {
    state.phase = newPhase;
    state.phaseDay = 1;
    state.staticStreak = 0;
    state.activeLock = null;
    state.lockLeft = 0;

    if (newPhase === 'mania') {
        state.phaseMinDays = 14 + Math.floor(Math.random() * 8);
    } else if (newPhase === 'depression') {
        state.phaseMinDays = 21 + Math.floor(Math.random() * 10);
        if (state.ptsd >= 4) state.phaseMinDays = Math.max(14, state.phaseMinDays - 3);
    } else if (newPhase === 'mixed') {
        state.phaseMinDays = 7 + Math.floor(Math.random() * 8);
    }
    saveState(state);
}

// ============================
// RENDER HTML
// ============================

function renderTracker(state) {
    const isMania = state.phase === 'mania' || state.phase === 'mixed';
    const isDepression = state.phase === 'depression';
    const borderColor = isDepression ? '#00fff7' : '#ff2d95';
    const headerColor = isDepression ? '#00fff7' : '#ff2d95';
    const headerGlow = isDepression
        ? '0 0 12px rgba(0,255,247,0.5)' : '0 0 12px rgba(255,45,149,0.5)';

    const dieColor = state.lastRollValue === '!!' ? '#e06c75'
        : state.lastRollValue === '♡' ? '#c678dd'
        : state.lastRollValue === '🔒' ? '#ff2d95'
        : state.lastRollValue === '—' ? '#555' : '#c8ff00';

    const resultColor = state.lastResult ? state.lastResult.color : '#666';
    const resultLabel = state.lastResult ? state.lastResult.label : 'NONE';
    const ptsdPct = (state.ptsd / 10) * 100;
    const aggrPct = (state.aggression / 10) * 100;

    const ptsdBarColor = isDepression ? '#333' : 'linear-gradient(90deg, #00fff7, #c8ff00)';
    const aggrBarColor = isDepression ? '#333' : 'linear-gradient(90deg, #c8ff00, #ff2d95)';
    const ptsdValColor = isDepression ? '#555' : '#c8ff00';
    const aggrValColor = isDepression ? '#555' : '#ff2d95';

    let lockText = 'NONE';
    let lockStyle = 'color:#333;border-color:#222;';
    if (state.activeLock === 'adrenaline') {
        lockText = `ADRENALINE LOCK — ${state.lockLeft} resp. left`;
        lockStyle = 'color:#ff2d95;border-color:#ff2d95;background:rgba(255,45,149,0.08);text-shadow:0 0 8px rgba(255,45,149,0.3);';
    } else if (state.activeLock === 'tenderness') {
        lockText = `TENDERNESS LOCK — ${state.lockLeft} resp. left`;
        lockStyle = 'color:#c678dd;border-color:#c678dd;background:rgba(198,120,221,0.08);text-shadow:0 0 8px rgba(198,120,221,0.3);';
    } else if (state.activeLock === 'depression_inertia') {
        lockText = `DEPRESSION INERTIA — streak ${state.staticStreak}`;
        lockStyle = 'color:#00fff7;border-color:#00fff7;background:rgba(0,255,247,0.06);text-shadow:0 0 8px rgba(0,255,247,0.3);';
    }

    function phaseBlock(name, isActive, accent) {
        const op = isActive ? '1' : '0.25';
        const bg = isActive ? `rgba(${accent === '#ff2d95' ? '255,45,149' : accent === '#00fff7' ? '0,255,247' : '229,192,123'},0.06)` : '#0d0d12';
        const bb = isActive ? `border-bottom:3px solid ${accent};` : '';
        const nc = isActive ? accent : '#555';
        const ng = isActive ? `text-shadow:0 0 8px ${accent}66;` : '';
        const dv = isActive ? `DAY ${state.phaseDay}` : '—';
        const dc = isActive ? accent : '#333';
        const mt = isActive ? `of min. ${state.phaseMinDays}` : '&nbsp;';
        return `<div style="flex:1;padding:12px 10px;text-align:center;border-right:1px dashed #222;opacity:${op};background:${bg};${bb}">
            <div style="font-family:'Courier New',monospace;font-size:13px;color:${nc};letter-spacing:2px;${ng}">${name}</div>
            <div style="font-size:24px;font-weight:bold;color:${dc};line-height:1.1;">${dv}</div>
            <div style="font-size:12px;color:#666;">${mt}</div>
        </div>`;
    }

    const dayPct = Math.min(100, (state.phaseDay / state.phaseMinDays) * 100);

    return `
    <div class="bpt-card" style="border:2px dashed ${borderColor};border-radius:2px;padding:0;background:#0d0d12;font-family:'Courier New',monospace;position:relative;overflow:hidden;margin-top:15px;">
        <div style="padding:14px 18px 10px;border-bottom:3px solid ${borderColor};display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:18px;font-weight:bold;color:${headerColor};text-shadow:${headerGlow};letter-spacing:1px;">🏥 CLINICAL CHART</span>
            <span style="font-size:11px;color:#444;text-decoration:line-through;text-decoration-color:${borderColor};">BIPOLAR DISORDER</span>
        </div>
        <div style="display:flex;border-bottom:1px dashed #222;">
            ${phaseBlock('MANIA', state.phase === 'mania', '#ff2d95')}
            ${phaseBlock('MIXED', state.phase === 'mixed', '#e5c07b')}
            ${phaseBlock('DEPRESSION', state.phase === 'depression', '#00fff7')}
        </div>
        <div style="padding:14px 18px;border-bottom:1px dashed #1a1a22;">
            <div style="font-size:12px;color:#ff9d3a;letter-spacing:2px;margin-bottom:10px;font-weight:bold;text-shadow:0 0 8px rgba(255,157,58,0.3);">BEHAVIORAL ROLL</div>
            <div style="display:flex;align-items:center;gap:16px;">
                <div style="width:58px;height:58px;border:2px solid ${dieColor};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:bold;color:${dieColor};text-shadow:0 0 14px ${dieColor}80;background:${dieColor}0a;transform:rotate(-3deg);flex-shrink:0;">${state.lastRollValue ?? '—'}</div>
                <div>
                    <div style="font-size:16px;font-weight:bold;color:${resultColor};text-shadow:0 0 10px ${resultColor}4d;">${resultLabel}</div>
                </div>
            </div>
        </div>
        <div style="padding:14px 18px;border-bottom:1px dashed #1a1a22;">
            <div style="font-size:12px;color:#ff9d3a;letter-spacing:2px;margin-bottom:10px;font-weight:bold;text-shadow:0 0 8px rgba(255,157,58,0.3);">ACCUMULATORS</div>
            <div style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;color:#00fff7;">PTSD trigger level</span>
                    <span style="font-size:14px;font-weight:bold;color:${ptsdValColor};">${state.ptsd} / 10</span>
                </div>
                <div style="width:100%;height:10px;background:#1a1a22;border-radius:2px;position:relative;">
                    <div style="height:100%;border-radius:2px;background:${ptsdBarColor};width:${ptsdPct}%;"></div>
                    <div style="position:absolute;top:-3px;left:40%;width:2px;height:16px;background:#ff2d95;"></div>
                    <div style="position:absolute;top:-3px;left:70%;width:2px;height:16px;background:#ff2d95;"></div>
                </div>
            </div>
            <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;color:#00fff7;">Suppressed aggression</span>
                    <span style="font-size:14px;font-weight:bold;color:${aggrValColor};">${state.aggression} / 10</span>
                </div>
                <div style="width:100%;height:10px;background:#1a1a22;border-radius:2px;position:relative;">
                    <div style="height:100%;border-radius:2px;background:${aggrBarColor};width:${aggrPct}%;"></div>
                    <div style="position:absolute;top:-3px;left:70%;width:2px;height:16px;background:#ff2d95;"></div>
                </div>
            </div>
        </div>
        <div style="padding:14px 18px;border-bottom:1px dashed #1a1a22;">
            <div style="font-size:12px;color:#ff9d3a;letter-spacing:2px;margin-bottom:10px;font-weight:bold;text-shadow:0 0 8px rgba(255,157,58,0.3);">ACTIVE LOCKS</div>
            <span style="display:inline-block;padding:4px 12px;border-radius:2px;font-size:13px;font-weight:bold;border:1px dashed;transform:rotate(-1deg);${lockStyle}">${lockText}</span>
        </div>
        <div style="padding:10px 18px 14px;">
            <div style="font-size:12px;color:#ff9d3a;letter-spacing:2px;margin-bottom:8px;font-weight:bold;text-shadow:0 0 8px rgba(255,157,58,0.3);">PHASE PROGRESS</div>
            <div style="width:100%;height:6px;background:#1a1a22;border-radius:2px;">
                <div style="height:100%;border-radius:2px;background:${borderColor};width:${dayPct}%;opacity:0.6;"></div>
            </div>
            <div style="font-size:11px;color:#5cc8c4;margin-top:4px;">Day ${state.phaseDay} of ${state.phaseMinDays} minimum</div>
        </div>
    </div>`;
}

// ============================
// PROMPT INJECTION
// ============================

function buildInjection(state) {
    if (!state.lastResult) return '';
    const lockInfo = state.activeLock ? `Lock: ${state.activeLock.toUpperCase()} (${state.lockLeft} left)` : 'No locks';
    return `[BIPOLAR STATE: ${state.phase.toUpperCase()} Day ${state.phaseDay}/${state.phaseMinDays} | PTSD: ${state.ptsd}/10 | Aggression: ${state.aggression}/10 | Roll: ${state.lastRollValue} → ${state.lastResult.label} | ${lockInfo}]
[Write character behavior consistent with this impulse. Do not announce tracker mechanics in narration.]
[Signal tags (hidden from chat): [PTSD+N] for PTSD trigger, [AGGR+N] for suppressed aggression, [DAY+N] for time passing, [ADRENALINE_SATISFIED] when need fulfilled, [AGGRESSION_OUTBURST] for violence outburst]`;
}

// ============================
// SETTINGS HTML
// ============================

function buildSettingsHtml() {
    return `
    <div id="bpt-settings" class="bpt-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🏥 Bipolar Tracker</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="font-size:13px;">
                <label class="checkbox_label" style="margin-bottom:8px;">
                    <input type="checkbox" id="bpt-enabled" />
                    <span>Enabled</span>
                </label>
                <label class="checkbox_label" style="margin-bottom:8px;">
                    <input type="checkbox" id="bpt-inject" />
                    <span>Inject state into prompt</span>
                </label>
                <label class="checkbox_label" style="margin-bottom:12px;">
                    <input type="checkbox" id="bpt-parse" />
                    <span>Parse model signal tags</span>
                </label>
                <hr />
                <b style="display:block;margin:8px 0 6px;">Manual Controls</b>
                <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                    <button id="bpt-set-mania" class="menu_button">→ Mania</button>
                    <button id="bpt-set-mixed" class="menu_button">→ Mixed</button>
                    <button id="bpt-set-depression" class="menu_button">→ Depression</button>
                </div>
                <div style="margin-bottom:6px;">
                    <label style="color:#aaa;">PTSD: <span id="bpt-ptsd-val">0</span>/10</label>
                    <input type="range" id="bpt-ptsd-slider" min="0" max="10" value="0" style="width:100%;" />
                </div>
                <div style="margin-bottom:6px;">
                    <label style="color:#aaa;">Aggression: <span id="bpt-aggr-val">0</span>/10</label>
                    <input type="range" id="bpt-aggr-slider" min="0" max="10" value="0" style="width:100%;" />
                </div>
                <div style="margin-bottom:6px;">
                    <label style="color:#aaa;">Phase Day: <span id="bpt-day-val">1</span></label>
                    <input type="range" id="bpt-day-slider" min="1" max="50" value="1" style="width:100%;" />
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;">
                    <button id="bpt-advance-day" class="menu_button">+1 Day</button>
                    <button id="bpt-unlock" class="menu_button">Clear Locks</button>
                    <button id="bpt-reset" class="menu_button" style="color:#e06c75;">Reset All</button>
                </div>
            </div>
        </div>
    </div>`;
}

// ============================
// EVENT HANDLERS
// ============================

function onMessageRendered(messageId) {
    try {
        const settings = getSettings();
        if (!settings.enabled) return;

        const context = getContext();
        if (!context.chatId) return;

        const message = context.chat[messageId];
        if (!message || message.is_user) return;

        let signalPtsd = 0, signalAggr = 0, dayAdv = 0;

        if (settings.parseSignals && message.mes) {
            const signals = parseSignals(message.mes);
            signalPtsd = signals.ptsd;
            signalAggr = signals.aggr;
            dayAdv = signals.dayAdvance;

            if (signals.cleaned !== message.mes) {
                const msgDiv = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
                if (msgDiv.length) {
                    msgDiv.html(msgDiv.html()
                        .replace(/\[PTSD\+\d+\]/gi, '')
                        .replace(/\[AGGR\+\d+\]/gi, '')
                        .replace(/\[DAY\+\d+\]/gi, '')
                        .replace(/\[ADRENALINE_SATISFIED\]/gi, '')
                        .replace(/\[AGGRESSION_OUTBURST\]/gi, '')
                    );
                }
            }

            if (signals.adrenSatisfied) {
                const s = getState();
                if (s.activeLock === 'adrenaline') { s.activeLock = null; s.lockLeft = 0; saveState(s); }
            }
            if (signals.aggrOutburst) {
                const s = getState();
                s.aggression = 0; s.activeLock = 'tenderness'; s.lockLeft = 2; saveState(s);
            }
        }

        if (dayAdv > 0) {
            const s = getState();
            advanceDay(s, dayAdv);
            saveState(s);
        }

        const state = tick(signalPtsd, signalAggr);
        const html = renderTracker(state);
        const msgBlock = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
        if (msgBlock.length) {
            msgBlock.find('.bpt-card').remove();
            msgBlock.append(html);
        }

        updateSettingsPanel(state);
        console.log(`[${EXT_NAME}] Tick: phase=${state.phase} day=${state.phaseDay} roll=${state.lastRollValue} result=${state.lastResult?.label} ptsd=${state.ptsd} aggr=${state.aggression}`);

    } catch (err) {
        console.error(`[${EXT_NAME}] onMessageRendered error:`, err);
    }
}

function updateSettingsPanel(state) {
    try {
        $('#bpt-ptsd-slider').val(state.ptsd);
        $('#bpt-ptsd-val').text(state.ptsd);
        $('#bpt-aggr-slider').val(state.aggression);
        $('#bpt-aggr-val').text(state.aggression);
        $('#bpt-day-slider').val(state.phaseDay);
        $('#bpt-day-val').text(state.phaseDay);
    } catch (err) {
        console.error(`[${EXT_NAME}] updateSettingsPanel error:`, err);
    }
}

// ============================
// INIT
// ============================

jQuery(async () => {
    try {
        console.log(`[${EXT_NAME}] jQuery ready, setting up...`);

        if (!extension_settings[EXT_NAME]) {
            extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS, chats: {} };
        }

        // Try multiple panel locations
        const settingsHtml = buildSettingsHtml();
        const targets = ['#extensions_settings2', '#extensions_settings', '#extensions_settings_content'];
        let attached = false;

        for (const sel of targets) {
            const $target = $(sel);
            if ($target.length) {
                $target.append(settingsHtml);
                console.log(`[${EXT_NAME}] Settings panel attached to ${sel}`);
                attached = true;
                break;
            }
        }

        if (!attached) {
            console.warn(`[${EXT_NAME}] Could not find settings panel container. Tried: ${targets.join(', ')}`);
        }

        // Settings bindings
        const settings = getSettings();
        $('#bpt-enabled').prop('checked', settings.enabled).on('change', function () {
            getSettings().enabled = $(this).is(':checked');
            saveSettingsDebounced();
        });
        $('#bpt-inject').prop('checked', settings.injectPrompt).on('change', function () {
            getSettings().injectPrompt = $(this).is(':checked');
            saveSettingsDebounced();
        });
        $('#bpt-parse').prop('checked', settings.parseSignals).on('change', function () {
            getSettings().parseSignals = $(this).is(':checked');
            saveSettingsDebounced();
        });

        // Manual controls
        $('#bpt-set-mania').on('click', () => { transitionPhase(getState(), 'mania'); updateSettingsPanel(getState()); });
        $('#bpt-set-mixed').on('click', () => { transitionPhase(getState(), 'mixed'); updateSettingsPanel(getState()); });
        $('#bpt-set-depression').on('click', () => { transitionPhase(getState(), 'depression'); updateSettingsPanel(getState()); });

        $('#bpt-ptsd-slider').on('input', function () {
            const v = parseInt($(this).val()); $('#bpt-ptsd-val').text(v);
            const s = getState(); s.ptsd = v; saveState(s);
        });
        $('#bpt-aggr-slider').on('input', function () {
            const v = parseInt($(this).val()); $('#bpt-aggr-val').text(v);
            const s = getState(); s.aggression = v; saveState(s);
        });
        $('#bpt-day-slider').on('input', function () {
            const v = parseInt($(this).val()); $('#bpt-day-val').text(v);
            const s = getState(); s.phaseDay = v; saveState(s);
        });

        $('#bpt-advance-day').on('click', () => { const s = getState(); advanceDay(s, 1); saveState(s); updateSettingsPanel(s); });
        $('#bpt-unlock').on('click', () => { const s = getState(); s.activeLock = null; s.lockLeft = 0; s.staticStreak = 0; saveState(s); });
        $('#bpt-reset').on('click', () => {
            const ctx = getContext();
            if (!ctx.chatId) return;
            extension_settings[EXT_NAME].chats[ctx.chatId] = { ...DEFAULT_STATE };
            saveSettingsDebounced();
            updateSettingsPanel(getState());
        });

        // Message rendered hook
        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
            console.log(`[${EXT_NAME}] Hooked CHARACTER_MESSAGE_RENDERED`);
        } else if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, onMessageRendered);
            console.log(`[${EXT_NAME}] Hooked MESSAGE_RECEIVED (fallback)`);
        } else {
            console.warn(`[${EXT_NAME}] No suitable message event found!`);
        }

        // Prompt injection hook
        const promptEvents = [
            'CHAT_COMPLETION_PROMPT_READY',
            'GENERATE_BEFORE_COMBINE_PROMPTS',
            'GENERATE_AFTER_COMBINE_PROMPTS',
        ];
        let promptHooked = false;
        for (const evName of promptEvents) {
            if (event_types[evName]) {
                eventSource.on(event_types[evName], (data) => {
                    try {
                        const settings = getSettings();
                        if (!settings.enabled || !settings.injectPrompt) return;
                        const state = getState();
                        const injection = buildInjection(state);
                        if (injection && data?.chat && Array.isArray(data.chat)) {
                            data.chat.push({ role: 'system', content: injection });
                        }
                    } catch (err) {
                        console.error(`[${EXT_NAME}] prompt injection error:`, err);
                    }
                });
                console.log(`[${EXT_NAME}] Prompt injection hooked via ${evName}`);
                promptHooked = true;
                break;
            }
        }
        if (!promptHooked) {
            console.warn(`[${EXT_NAME}] No prompt injection event found. Injection disabled.`);
        }

        console.log(`[${EXT_NAME}] Initialization complete!`);

    } catch (err) {
        console.error(`[${EXT_NAME}] INIT FAILED:`, err);
    }
});
