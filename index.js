import { extension_settings, getContext, saveSettingsDebounced } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

const EXT_NAME = 'bipolar-tracker';
const EXT_DISPLAY = 'Bipolar Disorder Tracker';

// ============================
// DEFAULT STATE
// ============================

const DEFAULT_SETTINGS = {
    enabled: true,
    injectPrompt: true,
    parseSignals: true,
};

const DEFAULT_STATE = {
    phase: 'mania',       // mania | depression | mixed
    phaseDay: 1,
    phaseMinDays: 14,
    ptsd: 0,              // 0-10
    aggression: 0,         // 0-10
    activeLock: null,      // null | 'adrenaline' | 'tenderness' | 'depression_inertia'
    lockLeft: 0,
    staticStreak: 0,
    lastRolls: [],         // last 3 roll values
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

// ============================
// PTSD-MODIFIED TABLES
// ============================

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
// DICE MECHANICS
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
        if (roll >= entry.min && roll <= entry.max) {
            return entry;
        }
    }
    return table[0];
}

// ============================
// STATE MANAGEMENT
// ============================

function getState() {
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
}

function saveState(state) {
    const context = getContext();
    const chatId = context.chatId;
    if (!chatId) return;

    extension_settings[EXT_NAME].chats[chatId] = state;
    saveSettingsDebounced();
}

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS, chats: {} };
    }
    return extension_settings[EXT_NAME];
}

// ============================
// CORE TICK — runs on each AI message
// ============================

function tick(signalPtsd = 0, signalAggr = 0) {
    const state = getState();
    const settings = getSettings();
    if (!settings.enabled) return state;

    // Apply signals from previous model output
    state.ptsd = Math.min(10, Math.max(0, state.ptsd + signalPtsd));
    state.aggression = Math.min(10, Math.max(0, state.aggression + signalAggr));

    // Check forced aggression explosion (threshold 7+)
    if (state.aggression >= 7 && state.phase !== 'depression') {
        state.lastResult = {
            id: 'forced_aggression',
            label: 'FORCED AGGRESSION EXPLOSION',
            color: '#e06c75',
        };
        state.lastRollValue = '!!';
        state.aggression = 0;
        state.activeLock = 'tenderness';
        state.lockLeft = 2;
        state.aggressionJustExploded = true;
        saveState(state);
        return state;
    }

    // Check active locks
    if (state.activeLock) {
        if (state.activeLock === 'tenderness') {
            state.lastResult = {
                id: 'tenderness',
                label: 'TENDERNESS / REMORSE',
                color: '#c678dd',
            };
            state.lastRollValue = '♡';
            state.lockLeft--;
            if (state.lockLeft <= 0) {
                state.activeLock = null;
            }
            saveState(state);
            return state;
        }

        if (state.activeLock === 'adrenaline') {
            state.lastResult = {
                id: 'adrenaline_locked',
                label: 'ADRENALINE LOCK (active)',
                color: '#ff2d95',
            };
            state.lastRollValue = '🔒';
            state.lockLeft--;
            if (state.lockLeft <= 0) {
                state.activeLock = null;
            }
            saveState(state);
            return state;
        }

        if (state.activeLock === 'depression_inertia') {
            state.lastResult = {
                id: 'static',
                label: 'STATIC (inertia holds)',
                color: '#555',
            };
            state.lastRollValue = '—';
            saveState(state);
            return state;
        }
    }

    // Roll the die
    const roll = rollD20(state.lastRolls);
    state.lastRolls.push(roll);
    if (state.lastRolls.length > 5) state.lastRolls.shift();
    state.lastRollValue = roll;

    // Resolve based on phase
    let table;
    if (state.phase === 'mania' || state.phase === 'mixed') {
        table = getManiaTable(state.ptsd);
    } else {
        table = getDepressionTable(state.ptsd);
    }

    const result = resolveRoll(roll, table);
    state.lastResult = result;

    // Post-roll effects
    if (state.phase === 'mania' || state.phase === 'mixed') {
        // Void = aggression +1
        if (result.id === 'void') {
            state.aggression = Math.min(10, state.aggression + 1);
        }

        // Adrenaline = lock
        if (result.id === 'adrenaline') {
            state.activeLock = 'adrenaline';
            state.lockLeft = 3;
        }

        // Impulsive behavior direction depends on aggression
        if (result.id === 'impulsive') {
            if (state.aggression >= 5) {
                state.lastResult = {
                    ...result,
                    label: 'IMPULSIVE BEHAVIOR (→ negative)',
                    direction: 'negative',
                };
            } else {
                state.lastResult = {
                    ...result,
                    label: 'IMPULSIVE BEHAVIOR (→ positive)',
                    direction: 'positive',
                };
            }
        }

        state.staticStreak = 0;
    }

    if (state.phase === 'depression') {
        if (result.id === 'static') {
            state.staticStreak++;
            if (state.staticStreak >= 3) {
                state.activeLock = 'depression_inertia';
            }
        } else {
            state.staticStreak = 0;
            state.activeLock = null; // break inertia if non-static rolls
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
    let ptsd = 0;
    let aggr = 0;
    let dayAdvance = 0;
    let cleaned = text;

    // [PTSD+N]
    const ptsdMatch = cleaned.match(/\[PTSD\+(\d+)\]/gi);
    if (ptsdMatch) {
        for (const m of ptsdMatch) {
            const val = parseInt(m.match(/\d+/)[0]);
            ptsd += val;
        }
        cleaned = cleaned.replace(/\[PTSD\+\d+\]/gi, '');
    }

    // [AGGR+N]
    const aggrMatch = cleaned.match(/\[AGGR\+(\d+)\]/gi);
    if (aggrMatch) {
        for (const m of aggrMatch) {
            const val = parseInt(m.match(/\d+/)[0]);
            aggr += val;
        }
        cleaned = cleaned.replace(/\[AGGR\+\d+\]/gi, '');
    }

    // [DAY+N]
    const dayMatch = cleaned.match(/\[DAY\+(\d+)\]/gi);
    if (dayMatch) {
        for (const m of dayMatch) {
            const val = parseInt(m.match(/\d+/)[0]);
            dayAdvance += val;
        }
        cleaned = cleaned.replace(/\[DAY\+\d+\]/gi, '');
    }

    // [ADRENALINE_SATISFIED]
    const adrenSatisfied = /\[ADRENALINE_SATISFIED\]/gi.test(cleaned);
    cleaned = cleaned.replace(/\[ADRENALINE_SATISFIED\]/gi, '');

    // [AGGRESSION_OUTBURST]
    const aggrOutburst = /\[AGGRESSION_OUTBURST\]/gi.test(cleaned);
    cleaned = cleaned.replace(/\[AGGRESSION_OUTBURST\]/gi, '');

    return { ptsd, aggr, dayAdvance, adrenSatisfied, aggrOutburst, cleaned };
}

// ============================
// DAY ADVANCE
// ============================

function advanceDay(state, days = 1) {
    state.phaseDay += days;

    // PTSD natural decay
    state.ptsd = Math.max(0, state.ptsd - days);

    // Check if phase transition is possible (but don't auto-transition)
    // Transition must be triggered manually or by model signal
}

// ============================
// PHASE TRANSITION
// ============================

function transitionPhase(state, newPhase) {
    if (newPhase === 'mania') {
        state.phase = 'mania';
        state.phaseDay = 1;
        state.phaseMinDays = 14 + Math.floor(Math.random() * 8); // 14-21
        state.staticStreak = 0;
        state.activeLock = null;
        state.lockLeft = 0;
    } else if (newPhase === 'depression') {
        state.phase = 'depression';
        state.phaseDay = 1;
        state.phaseMinDays = 21 + Math.floor(Math.random() * 10); // 21-30
        // PTSD 4+ reduces min by 3
        if (state.ptsd >= 4) {
            state.phaseMinDays = Math.max(14, state.phaseMinDays - 3);
        }
        state.staticStreak = 0;
        state.activeLock = null;
        state.lockLeft = 0;
    } else if (newPhase === 'mixed') {
        state.phase = 'mixed';
        state.phaseDay = 1;
        state.phaseMinDays = 7 + Math.floor(Math.random() * 8); // 7-14
        state.staticStreak = 0;
        state.activeLock = null;
        state.lockLeft = 0;
    }
    saveState(state);
}

// ============================
// RENDER TRACKER HTML
// ============================

function renderTracker(state) {
    const isMania = state.phase === 'mania' || state.phase === 'mixed';
    const isDepression = state.phase === 'depression';
    const borderColor = isDepression ? '#00fff7' : '#ff2d95';
    const headerColor = isDepression ? '#00fff7' : '#ff2d95';
    const headerGlow = isDepression
        ? '0 0 12px rgba(0,255,247,0.5), 0 0 30px rgba(0,255,247,0.2)'
        : '0 0 12px rgba(255,45,149,0.5), 0 0 30px rgba(255,45,149,0.2)';

    const dieColor = state.lastRollValue === '!!' ? '#e06c75'
        : state.lastRollValue === '♡' ? '#c678dd'
        : state.lastRollValue === '🔒' ? '#ff2d95'
        : state.lastRollValue === '—' ? '#555'
        : '#c8ff00';

    const resultColor = state.lastResult ? state.lastResult.color : '#666';
    const resultLabel = state.lastResult ? state.lastResult.label : 'NONE';

    const ptsdPct = (state.ptsd / 10) * 100;
    const aggrPct = (state.aggression / 10) * 100;

    const ptsdBarColor = isDepression
        ? (state.ptsd > 0 ? 'linear-gradient(90deg, #333, #555)' : '#222')
        : 'linear-gradient(90deg, #00fff7, #c8ff00)';
    const aggrBarColor = isDepression
        ? (state.aggression > 0 ? 'linear-gradient(90deg, #333, #555)' : '#222')
        : 'linear-gradient(90deg, #c8ff00, #ff2d95)';

    const ptsdColor = isDepression ? '#555' : '#c8ff00';
    const aggrColor = isDepression ? '#555' : '#ff2d95';
    const noteColor = isDepression ? '#5a8a87' : '#5cc8c4';

    // Lock display
    let lockText = 'NONE';
    let lockStyle = 'color: #333; border-color: #222;';
    if (state.activeLock === 'adrenaline') {
        lockText = `ADRENALINE LOCK — ${state.lockLeft} resp. left`;
        lockStyle = `color: #ff2d95; border-color: #ff2d95; background: rgba(255,45,149,0.08); text-shadow: 0 0 8px rgba(255,45,149,0.3);`;
    } else if (state.activeLock === 'tenderness') {
        lockText = `TENDERNESS LOCK — ${state.lockLeft} resp. left`;
        lockStyle = `color: #c678dd; border-color: #c678dd; background: rgba(198,120,221,0.08); text-shadow: 0 0 8px rgba(198,120,221,0.3);`;
    } else if (state.activeLock === 'depression_inertia') {
        lockText = `DEPRESSION INERTIA — static streak ${state.staticStreak}`;
        lockStyle = `color: #00fff7; border-color: #00fff7; background: rgba(0,255,247,0.06); text-shadow: 0 0 8px rgba(0,255,247,0.3);`;
    }

    // Phase strip
    function phaseBlock(name, isActive, accentColor) {
        const opacity = isActive ? '1' : '0.25';
        const bg = isActive ? `rgba(${accentColor === '#ff2d95' ? '255,45,149' : accentColor === '#00fff7' ? '0,255,247' : '200,200,200'},0.06)` : '#0d0d12';
        const nameColor = isActive ? accentColor : '#555';
        const nameGlow = isActive ? `text-shadow: 0 0 8px ${accentColor}66;` : '';
        const dayVal = isActive ? `DAY ${state.phaseDay}` : '—';
        const dayColor = isActive ? accentColor : '#333';
        const minText = isActive ? `of min. ${state.phaseMinDays}` : '&nbsp;';
        const borderBottom = isActive ? `border-bottom: 3px solid ${accentColor};` : '';

        return `
            <div style="flex: 1; padding: 12px 10px; text-align: center; border-right: 1px dashed #222; opacity: ${opacity}; background: ${bg}; ${borderBottom}">
                <div style="font-family: 'Courier New', monospace; font-size: 13px; color: ${nameColor}; letter-spacing: 2px; ${nameGlow}">${name}</div>
                <div style="font-size: 24px; font-weight: bold; color: ${dayColor}; line-height: 1.1;">${dayVal}</div>
                <div style="font-size: 12px; color: #666;">${minText}</div>
            </div>
        `;
    }

    const maniaActive = state.phase === 'mania' || state.phase === 'mixed';
    const mixedActive = state.phase === 'mixed';
    const deprActive = state.phase === 'depression';

    return `
    <div class="bpt-card" style="border: 2px dashed ${borderColor}; border-radius: 2px; padding: 0; background-color: #0d0d12; font-family: 'Courier New', monospace; position: relative; overflow: hidden; margin-top: 15px;">

        <div style="padding: 14px 18px 10px; border-bottom: 3px solid ${borderColor}; display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-size: 18px; font-weight: bold; color: ${headerColor}; text-shadow: ${headerGlow}; letter-spacing: 1px;">🏥 CLINICAL CHART</span>
            <span style="font-family: 'Courier New', monospace; font-size: 11px; color: #444; text-decoration: line-through; text-decoration-color: ${borderColor};">BIPOLAR DISORDER</span>
        </div>

        <div style="display: flex; border-bottom: 1px dashed #222;">
            ${phaseBlock('MANIA', maniaActive && !mixedActive, '#ff2d95')}
            ${phaseBlock('MIXED', mixedActive, '#e5c07b')}
            ${phaseBlock('DEPRESSION', deprActive, '#00fff7')}
        </div>

        <div style="padding: 14px 18px; border-bottom: 1px dashed #1a1a22;">
            <div style="font-size: 12px; color: #ff9d3a; letter-spacing: 2px; margin-bottom: 10px; font-weight: bold; text-shadow: 0 0 8px rgba(255,157,58,0.3);">BEHAVIORAL ROLL</div>
            <div style="display: flex; align-items: center; gap: 16px;">
                <div style="width: 58px; height: 58px; border: 2px solid ${dieColor}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; color: ${dieColor}; text-shadow: 0 0 14px ${dieColor}80; background: ${dieColor}0a; transform: rotate(-3deg); flex-shrink: 0;">
                    ${state.lastRollValue ?? '—'}
                </div>
                <div>
                    <div style="font-size: 16px; font-weight: bold; color: ${resultColor}; text-shadow: 0 0 10px ${resultColor}4d;">${resultLabel}</div>
                </div>
            </div>
        </div>

        <div style="padding: 14px 18px; border-bottom: 1px dashed #1a1a22;">
            <div style="font-size: 12px; color: #ff9d3a; letter-spacing: 2px; margin-bottom: 10px; font-weight: bold; text-shadow: 0 0 8px rgba(255,157,58,0.3);">ACCUMULATORS</div>

            <div style="margin-bottom: 14px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 13px; color: #00fff7;">PTSD trigger level</span>
                    <span style="font-size: 14px; font-weight: bold; color: ${ptsdColor};">${state.ptsd} / 10</span>
                </div>
                <div style="width: 100%; height: 10px; background: #1a1a22; border-radius: 2px; position: relative;">
                    <div style="height: 100%; border-radius: 2px; background: ${ptsdBarColor}; width: ${ptsdPct}%;"></div>
                    <div style="position: absolute; top: -3px; left: 40%; width: 2px; height: 16px; background: #ff2d95;"></div>
                    <div style="position: absolute; top: -3px; left: 70%; width: 2px; height: 16px; background: #ff2d95;"></div>
                </div>
            </div>

            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 13px; color: #00fff7;">Suppressed aggression</span>
                    <span style="font-size: 14px; font-weight: bold; color: ${aggrColor};">${state.aggression} / 10</span>
                </div>
                <div style="width: 100%; height: 10px; background: #1a1a22; border-radius: 2px; position: relative;">
                    <div style="height: 100%; border-radius: 2px; background: ${aggrBarColor}; width: ${aggrPct}%;"></div>
                    <div style="position: absolute; top: -3px; left: 70%; width: 2px; height: 16px; background: #ff2d95;"></div>
                </div>
            </div>
        </div>

        <div style="padding: 14px 18px; border-bottom: 1px dashed #1a1a22;">
            <div style="font-size: 12px; color: #ff9d3a; letter-spacing: 2px; margin-bottom: 10px; font-weight: bold; text-shadow: 0 0 8px rgba(255,157,58,0.3);">ACTIVE LOCKS</div>
            <span style="display: inline-block; padding: 4px 12px; border-radius: 2px; font-size: 13px; font-weight: bold; border: 1px dashed; transform: rotate(-1deg); ${lockStyle}">
                ${lockText}
            </span>
        </div>

        <div style="padding: 10px 18px 14px;">
            <div style="font-size: 12px; color: #ff9d3a; letter-spacing: 2px; margin-bottom: 8px; font-weight: bold; text-shadow: 0 0 8px rgba(255,157,58,0.3);">PHASE DAY ${state.phaseDay} / ${state.phaseMinDays}</div>
            <div style="width: 100%; height: 6px; background: #1a1a22; border-radius: 2px;">
                <div style="height: 100%; border-radius: 2px; background: ${borderColor}; width: ${Math.min(100, (state.phaseDay / state.phaseMinDays) * 100)}%; opacity: 0.6;"></div>
            </div>
        </div>

    </div>
    `;
}

// ============================
// PROMPT INJECTION
// ============================

function buildInjection(state) {
    if (!state.lastResult) return '';

    const lockInfo = state.activeLock
        ? `Lock: ${state.activeLock.toUpperCase()} (${state.lockLeft} left)`
        : 'No locks';

    return `[BIPOLAR STATE: ${state.phase.toUpperCase()} Day ${state.phaseDay}/${state.phaseMinDays} | PTSD: ${state.ptsd}/10 | Aggression: ${state.aggression}/10 | Roll: ${state.lastRollValue} → ${state.lastResult.label} | ${lockInfo}]
[The character's current behavioral impulse is: ${state.lastResult.label}. Write the character's actions and inner state consistent with this impulse. Do not announce the tracker mechanics in narration.]
[Signal tags for the extension (write these ONLY when relevant, they will be hidden from chat):
- [PTSD+N] when a PTSD trigger occurs (N = severity 1-3)
- [AGGR+N] when character suppresses aggression (N = 1 or 2)
- [DAY+N] when N in-universe days pass
- [ADRENALINE_SATISFIED] when the adrenaline need is fulfilled
- [AGGRESSION_OUTBURST] when character has a violence outburst]`;
}

// ============================
// SETTINGS PANEL HTML
// ============================

function buildSettingsHtml() {
    return `
    <div id="bpt-settings" class="bpt-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🏥 Bipolar Tracker</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="font-size: 13px;">

                <label class="checkbox_label" style="margin-bottom: 8px;">
                    <input type="checkbox" id="bpt-enabled" />
                    <span>Enabled</span>
                </label>

                <label class="checkbox_label" style="margin-bottom: 8px;">
                    <input type="checkbox" id="bpt-inject" />
                    <span>Inject state into prompt</span>
                </label>

                <label class="checkbox_label" style="margin-bottom: 12px;">
                    <input type="checkbox" id="bpt-parse" />
                    <span>Parse model signal tags</span>
                </label>

                <hr />
                <b style="display: block; margin: 8px 0 6px;">Manual Controls</b>

                <div style="display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;">
                    <button id="bpt-set-mania" class="menu_button">→ Mania</button>
                    <button id="bpt-set-mixed" class="menu_button">→ Mixed</button>
                    <button id="bpt-set-depression" class="menu_button">→ Depression</button>
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="color: #aaa;">PTSD Level: <span id="bpt-ptsd-val">0</span>/10</label>
                    <input type="range" id="bpt-ptsd-slider" min="0" max="10" value="0" style="width: 100%;" />
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="color: #aaa;">Aggression: <span id="bpt-aggr-val">0</span>/10</label>
                    <input type="range" id="bpt-aggr-slider" min="0" max="10" value="0" style="width: 100%;" />
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="color: #aaa;">Phase Day: <span id="bpt-day-val">1</span></label>
                    <input type="range" id="bpt-day-slider" min="1" max="50" value="1" style="width: 100%;" />
                </div>

                <div style="display: flex; gap: 6px; margin-top: 8px;">
                    <button id="bpt-advance-day" class="menu_button">+1 Day</button>
                    <button id="bpt-unlock" class="menu_button">Clear Locks</button>
                    <button id="bpt-reset" class="menu_button" style="color: #e06c75;">Reset All</button>
                </div>

            </div>
        </div>
    </div>
    `;
}

// ============================
// EVENT HANDLERS
// ============================

function onMessageRendered(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = getContext();
    if (!context.chatId) return;

    // Only process AI messages
    const message = context.chat[messageId];
    if (!message || message.is_user) return;

    // Parse signals from message text
    let signalPtsd = 0;
    let signalAggr = 0;
    let dayAdv = 0;

    if (settings.parseSignals && message.mes) {
        const signals = parseSignals(message.mes);
        signalPtsd = signals.ptsd;
        signalAggr = signals.aggr;
        dayAdv = signals.dayAdvance;

        // Clean signal tags from displayed message
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

        // Handle special signals
        if (signals.adrenSatisfied) {
            const state = getState();
            if (state.activeLock === 'adrenaline') {
                state.activeLock = null;
                state.lockLeft = 0;
                saveState(state);
            }
        }

        if (signals.aggrOutburst) {
            const state = getState();
            state.aggression = 0;
            state.activeLock = 'tenderness';
            state.lockLeft = 2;
            saveState(state);
        }
    }

    // Advance days if signaled
    if (dayAdv > 0) {
        const state = getState();
        advanceDay(state, dayAdv);
        saveState(state);
    }

    // Tick the system
    const state = tick(signalPtsd, signalAggr);

    // Render and append tracker
    const html = renderTracker(state);
    const msgBlock = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if (msgBlock.length) {
        msgBlock.find('.bpt-card').remove(); // remove old if re-rendered
        msgBlock.append(html);
    }

    // Update settings panel
    updateSettingsPanel(state);
}

function updateSettingsPanel(state) {
    $('#bpt-ptsd-slider').val(state.ptsd);
    $('#bpt-ptsd-val').text(state.ptsd);
    $('#bpt-aggr-slider').val(state.aggression);
    $('#bpt-aggr-val').text(state.aggression);
    $('#bpt-day-slider').val(state.phaseDay);
    $('#bpt-day-val').text(state.phaseDay);
}

// ============================
// INITIALIZATION
// ============================

jQuery(async () => {
    // Initialize settings
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS, chats: {} };
    }

    // Add settings panel
    const settingsHtml = buildSettingsHtml();
    $('#extensions_settings2').append(settingsHtml);

    // Load current settings into UI
    const settings = getSettings();
    $('#bpt-enabled').prop('checked', settings.enabled).on('change', function () {
        settings.enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });
    $('#bpt-inject').prop('checked', settings.injectPrompt).on('change', function () {
        settings.injectPrompt = $(this).is(':checked');
        saveSettingsDebounced();
    });
    $('#bpt-parse').prop('checked', settings.parseSignals).on('change', function () {
        settings.parseSignals = $(this).is(':checked');
        saveSettingsDebounced();
    });

    // Manual controls
    $('#bpt-set-mania').on('click', () => {
        const state = getState();
        transitionPhase(state, 'mania');
        updateSettingsPanel(state);
    });
    $('#bpt-set-mixed').on('click', () => {
        const state = getState();
        transitionPhase(state, 'mixed');
        updateSettingsPanel(state);
    });
    $('#bpt-set-depression').on('click', () => {
        const state = getState();
        transitionPhase(state, 'depression');
        updateSettingsPanel(state);
    });

    $('#bpt-ptsd-slider').on('input', function () {
        const val = parseInt($(this).val());
        $('#bpt-ptsd-val').text(val);
        const state = getState();
        state.ptsd = val;
        saveState(state);
    });

    $('#bpt-aggr-slider').on('input', function () {
        const val = parseInt($(this).val());
        $('#bpt-aggr-val').text(val);
        const state = getState();
        state.aggression = val;
        saveState(state);
    });

    $('#bpt-day-slider').on('input', function () {
        const val = parseInt($(this).val());
        $('#bpt-day-val').text(val);
        const state = getState();
        state.phaseDay = val;
        saveState(state);
    });

    $('#bpt-advance-day').on('click', () => {
        const state = getState();
        advanceDay(state, 1);
        saveState(state);
        updateSettingsPanel(state);
    });

    $('#bpt-unlock').on('click', () => {
        const state = getState();
        state.activeLock = null;
        state.lockLeft = 0;
        state.staticStreak = 0;
        saveState(state);
    });

    $('#bpt-reset').on('click', () => {
        const context = getContext();
        if (!context.chatId) return;
        extension_settings[EXT_NAME].chats[context.chatId] = { ...DEFAULT_STATE };
        saveSettingsDebounced();
        updateSettingsPanel(getState());
    });

    // Hook into message rendering
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        onMessageRendered(messageId);
    });

    // Prompt injection
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
        const settings = getSettings();
        if (!settings.enabled || !settings.injectPrompt) return;

        const state = getState();
        const injection = buildInjection(state);
        if (injection && data?.chat) {
            // Inject as system message near the end of chat
            data.chat.push({
                role: 'system',
                content: injection,
            });
        }
    });

    console.log(`[${EXT_NAME}] Loaded.`);
});
