/*************************
 * Defaults & Persistence
 *************************/
const DEFAULT_FORMATION   = "433";
const DEFAULT_ORIENTATION = "right"; // "up" | "right" | "down" | "left"

const LS_KEYS = {
  roster:      "soccer.roster",
  attendance:  "soccer.attendance",
  assignments: "soccer.assignments",
  formation:   "soccer.formation",
  orientation: "soccer.orientation",
  minutes:     "soccer.minutes",  // { [pid]: { totalMs, activeStartMs|null } }
  clock:       "soccer.clock"     // { running, startedAt, elapsedMs }
};

const ls = {
  load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
    catch { return fallback; }
  },
  save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

/*************************
 * Formations & Base Coords (UP)
 * Coordinates assume the team attacks toward the TOP ("up").
 * We'll rotate them at render-time based on current orientation.
 *************************/
const FORMATIONS = {
  "433": ["GK","RB","RCB","LCB","LB","RM","CM","LM","RW","ST","LW"],
  "442": ["GK","RB","RCB","LCB","LB","RM","RCM","LCM","LM","RST","LST"],
  "352": ["GK","RCB","CB","LCB","RWB","RDM","CAM","LDM","LWB","RST","LST"]
};

const FIELD_COORDS_UP = {
  "433": {
    GK:[50,92],
    RB:[78,78], RCB:[62,74], LCB:[38,74], LB:[22,78],
    RM:[72,56], CM:[50,50], LM:[28,56],
    RW:[70,30], ST:[50,24], LW:[30,30]
  },
  "442": {
    GK:[50,92],
    RB:[78,78], RCB:[62,74], LCB:[38,74], LB:[22,78],
    RM:[72,56], RCM:[58,50], LCM:[42,50], LM:[28,56],
    RST:[58,28], LST:[42,28]
  },
  "352": {
    GK:[50,92],
    RCB:[62,80], CB:[50,82], LCB:[38,80],
    RWB:[76,60], RDM:[58,52], CAM:[50,40], LDM:[42,52], LWB:[24,60],
    RST:[56,28], LST:[44,28]
  }
};

/*************************
 * Seed roster
 *************************/
const ROSTER_SEED = [
  { id: "p1", name: "Alex",  number:  2 },
  { id: "p2", name: "Brian", number:  3 },
  { id: "p3", name: "Chris", number:  4 },
  { id: "p4", name: "David", number:  7 },
  { id: "p5", name: "Ethan", number:  9 },
  { id: "p6", name: "Frank", number: 10 },
  { id: "p7", name: "Gabe",  number: 11 },
  { id: "p8", name: "Henry", number: 12 }
];

/*************************
 * App State & DOM refs
 *************************/
let roster           = ls.load(LS_KEYS.roster,      ROSTER_SEED);
let attendance       = ls.load(LS_KEYS.attendance,  {});            // id -> boolean
let assignments      = ls.load(LS_KEYS.assignments, {});            // pos -> playerId
let currentFormation = ls.load(LS_KEYS.formation,   DEFAULT_FORMATION);
let orientation      = ls.load(LS_KEYS.orientation, DEFAULT_ORIENTATION);

// Per-player minutes
let minutes = ls.load(LS_KEYS.minutes, {}); // { [pid]: { totalMs, activeStartMs } }

// Game clock state
let clock = ls.load(LS_KEYS.clock, {
  running:   false,
  startedAt: null, // epoch ms when started
  elapsedMs: 0     // accumulated ms when paused
});
let clockInterval = null;

// DOM
let allPlayersDiv, presentPlayersDiv, lineupDiv, formationSelect, orientationSelect;
let clockDisplay, clockStartBtn, clockPauseBtn, clockResetBtn;
let backdrop, assignTitle, playerSelect, posSelect, saveBtn, cancelBtn, unassignBtn;

/*************************
 * Helpers (time/format)
 *************************/
function nowMs() { return Date.now(); }

function fmtMMSS(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/*************************
 * Helpers (positions/coords)
 *************************/
function positionsForKey(key) {
  return FORMATIONS[key] ?? FORMATIONS[DEFAULT_FORMATION];
}
function positionsForCurrentFormation() {
  return positionsForKey(currentFormation);
}

// Rotate a point (x,y in 0..100) from UP into the chosen orientation.
function rotateFromUp([x, y]) {
  // UP -> RIGHT: (y, 100 - x)
  // UP -> DOWN:  (100 - x, 100 - y)
  // UP -> LEFT:  (100 - y, x)
  switch (orientation) {
    case "right": return [y, 100 - x];
    case "down":  return [100 - x, 100 - y];
    case "left":  return [100 - y, x];
    case "up":
    default:      return [x, y];
  }
}

function coordsFor(posKey) {
  const table = FIELD_COORDS_UP[currentFormation] ?? FIELD_COORDS_UP[DEFAULT_FORMATION];
  const base  = table[posKey] || [50,50];
  return rotateFromUp(base);
}

function currentPositionOf(playerId) {
  for (const pos of Object.keys(assignments)) {
    if (assignments[pos] === playerId) return pos;
  }
  return null;
}

/*************************
 * Persistence
 *************************/
function persist() {
  ls.save(LS_KEYS.roster,      roster);
  ls.save(LS_KEYS.attendance,  attendance);
  ls.save(LS_KEYS.assignments, assignments);
  ls.save(LS_KEYS.formation,   currentFormation);
  ls.save(LS_KEYS.orientation, orientation);
  ls.save(LS_KEYS.minutes,     minutes);
  ls.save(LS_KEYS.clock,       clock);
}

/*************************
 * Minutes tracking helpers
 *************************/
function ensureMinutes(pid) {
  if (!minutes[pid]) minutes[pid] = { totalMs: 0, activeStartMs: null };
  return minutes[pid];
}

function beginPlayerSessionIfRunning(pid) {
  if (!pid) return;
  const m = ensureMinutes(pid);
  if (clock.running && m.activeStartMs == null) {
    m.activeStartMs = nowMs();
  }
}

function endPlayerSessionIfActive(pid) {
  if (!pid) return;
  const m = ensureMinutes(pid);
  if (m.activeStartMs != null) {
    m.totalMs += (nowMs() - m.activeStartMs);
    m.activeStartMs = null;
  }
}

function effectivePlayerMs(pid) {
  const m = ensureMinutes(pid);
  let extra = 0;
  if (m.activeStartMs != null && clock.running) {
    extra = nowMs() - m.activeStartMs;
  }
  return m.totalMs + extra;
}

/*************************
 * Game Clock logic
 *************************/
function computeElapsedMs() {
  if (!clock.running || !clock.startedAt) return clock.elapsedMs;
  return clock.elapsedMs + (nowMs() - clock.startedAt);
}

function updateClockUI() {
  if (!clockDisplay) return;
  clockDisplay.textContent = fmtMMSS(computeElapsedMs());
  if (clockStartBtn && clockPauseBtn) {
    clockStartBtn.disabled = clock.running;
    clockPauseBtn.disabled = !clock.running;
  }
}

function startTickingIfNeeded() {
  if (clock.running && !clockInterval) {
    clockInterval = setInterval(() => {
      updateClockUI();
      // keep minutes display fresh
      renderAll();
    }, 1000);
  }
}
function stopTicking() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

function startClock() {
  if (clock.running) return;
  clock.running = true;
  clock.startedAt = nowMs();

  // Start live session for all currently assigned players
  for (const pos of Object.keys(assignments)) {
    const pid = assignments[pos];
    if (pid) beginPlayerSessionIfRunning(pid);
  }

  persist();
  updateClockUI();
  startTickingIfNeeded();
}

function pauseClock() {
  if (!clock.running) return;

  // End live session for all currently assigned players
  const stopAt = nowMs();
  for (const pos of Object.keys(assignments)) {
    const pid = assignments[pos];
    if (pid) endPlayerSessionIfActive(pid);
  }

  // Freeze the game clock
  clock.elapsedMs = computeElapsedMs();
  clock.running   = false;
  clock.startedAt = null;

  persist();
  updateClockUI();
  stopTicking();
  renderAll();
}

function resetClock() {
  // Reset clock + stop any active sessions (totals remain)
  if (!confirm("Reset game clock and stop active sessions? (Totals remain)")) return;

  clock.running   = false;
  clock.startedAt = null;
  clock.elapsedMs = 0;
  stopTicking();

  // End any active player sessions without adding extra time
  for (const pid of Object.keys(minutes)) {
    minutes[pid].activeStartMs = null;
  }

  persist();
  updateClockUI();
  renderAll();
}

/*************************
 * Rendering: Roster
 *************************/
function renderAllPlayers() {
  allPlayersDiv.innerHTML = "";
  roster.forEach(p => {
    const div = document.createElement("div");
    div.className = "player" + (attendance[p.id] ? " present" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!attendance[p.id];
    cb.addEventListener("change", () => {
      attendance[p.id] = cb.checked;

      if (!cb.checked) {
        // If they were assigned anywhere, end their session and remove assignment(s)
        for (const pos of Object.keys(assignments)) {
          if (assignments[pos] === p.id) {
            endPlayerSessionIfActive(p.id);
            delete assignments[pos];
          }
        }
      }

      persist();
      renderAll();
    });

    const label = document.createElement("label");
    label.textContent = `${p.number ?? "•"}  ${p.name}`;

    div.appendChild(cb);
    div.appendChild(label);
    allPlayersDiv.appendChild(div);
  });
}

function renderPresentPlayers() {
  presentPlayersDiv.innerHTML = "";
  const present = roster.filter(p => attendance[p.id]);
  present.forEach(p => {
    const chip = document.createElement("button");
    chip.className = "present-chip";
    chip.setAttribute("aria-label", `Assign ${p.name} to a position`);
    chip.textContent = `${p.number ?? ""} ${p.name}`.trim();
    chip.addEventListener("click", () => openAssignModal({ playerId: p.id }));
    presentPlayersDiv.appendChild(chip);
  });
  if (present.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No one checked in yet.";
    presentPlayersDiv.appendChild(empty);
  }
}

/*************************
 * Rendering: Lineup
 *************************/
function renderLineup() {
  lineupDiv.innerHTML = "";
  const POSITIONS = positionsForCurrentFormation();

  POSITIONS.forEach(pos => {
    const row = document.createElement("div");
    row.className = "line";

    const tag = document.createElement("div");
    tag.className = "pos-tag";
    tag.textContent = pos;

    const name = document.createElement("div");
    name.className = "assign-name";
    const pid = assignments[pos];

    if (pid) {
      const p = roster.find(r => r.id === pid);
      if (p) {
        const total = effectivePlayerMs(pid);
        name.textContent = `${(p.number ?? "").toString().trim()} ${p.name} — ${fmtMMSS(total)}`.trim();
      } else {
        name.textContent = "—";
        name.classList.add("muted");
      }
    } else {
      name.textContent = "—";
      name.classList.add("muted");
    }

    const clearBtn = document.createElement("button");
    clearBtn.className = "small-btn";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = !pid;
    clearBtn.addEventListener("click", () => {
      const prevPid = assignments[pos];
      if (prevPid) endPlayerSessionIfActive(prevPid);
      delete assignments[pos];
      persist();
      renderAll();
    });

    row.appendChild(tag);
    row.appendChild(name);
    row.appendChild(clearBtn);
    lineupDiv.appendChild(row);
  });
}

/*************************
 * Rendering: Field (image)
 *************************/
function renderField() {
  const field = document.getElementById("field");
  if (!field) return;
  field.innerHTML = "";

  const POSITIONS = positionsForCurrentFormation();

  POSITIONS.forEach(pos => {
    const [x,y] = coordsFor(pos);
    const pid = assignments[pos];
    const player = pid ? roster.find(r => r.id === pid) : null;

    const spot = document.createElement("div");
    spot.className = "spot" + (player ? "" : " empty");
    spot.style.left = x + "%";
    spot.style.top  = y + "%";

    const posEl = document.createElement("div");
    posEl.className = "pos";
    posEl.textContent = pos;

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    if (player) {
      const total = effectivePlayerMs(player.id);
      nameEl.textContent = `${(player.number ?? "").toString().trim()} ${player.name} — ${fmtMMSS(total)}`.trim();
    } else {
      nameEl.textContent = "—";
    }

    spot.appendChild(posEl);
    spot.appendChild(nameEl);

    // Click to assign to this position
    spot.addEventListener("click", () => openAssignModal({ positionKey: pos }));

    field.appendChild(spot);
  });
}

/*************************
 * Render all
 *************************/
function renderAll() {
  renderAllPlayers();
  renderPresentPlayers();
  renderLineup();
  renderField();
}

/*************************
 * Formation / Orientation change
 *************************/
function changeFormation(nextKey) {
  const nextPositions = new Set(positionsForKey(nextKey));

  // End sessions for players in positions that will be removed
  for (const pos of Object.keys(assignments)) {
    if (!nextPositions.has(pos)) {
      const pid = assignments[pos];
      if (pid) endPlayerSessionIfActive(pid);
    }
  }

  // Keep only assignments whose labels still exist in the new formation
  const nextAssignments = {};
  Object.keys(assignments).forEach(label => {
    if (nextPositions.has(label)) nextAssignments[label] = assignments[label];
  });

  assignments = nextAssignments;
  currentFormation = nextKey;
  persist();
  renderAll();
}

/*************************
 * Assign Modal logic
 *************************/
function openAssignModal({ playerId = null, positionKey = null } = {}) {
  // Only present players can be assigned
  const presentPlayers = roster.filter(p => attendance[p.id]);
  if (presentPlayers.length === 0) {
    alert("No players are checked in.");
    return;
  }

  assignTitle.textContent = "Assign";

  // Players
  playerSelect.innerHTML = "";
  presentPlayers.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.number ?? ""} ${p.name}`.trim();
    playerSelect.appendChild(opt);
  });
  if (playerId) playerSelect.value = playerId;

  // Positions (free or held by selected player)
  const POSITIONS = positionsForCurrentFormation();
  posSelect.innerHTML = "";
  POSITIONS.forEach(pos => {
    const takenBy = assignments[pos];
    const allowed = !takenBy || (playerId && takenBy === playerId);
    if (allowed) {
      const opt = document.createElement("option");
      opt.value = pos;
      opt.textContent = pos;
      posSelect.appendChild(opt);
    }
  });

  // Preselect if provided
  if (positionKey) {
    for (const o of posSelect.options) if (o.value === positionKey) posSelect.value = positionKey;
  } else if (playerId) {
    const at = currentPositionOf(playerId);
    if (at) posSelect.value = at;
  }

  // Unassign visibility
  const activePlayerId = playerSelect.value;
  unassignBtn.style.display = currentPositionOf(activePlayerId) ? "inline-block" : "none";

  // Respond to player change
  playerSelect.onchange = () => {
    const pid = playerSelect.value;
    unassignBtn.style.display = currentPositionOf(pid) ? "inline-block" : "none";

    posSelect.innerHTML = "";
    const POS = positionsForCurrentFormation();
    POS.forEach(pos => {
      const takenBy = assignments[pos];
      const allowed = !takenBy || takenBy === pid;
      if (allowed) {
        const opt = document.createElement("option");
        opt.value = pos;
        opt.textContent = pos;
        posSelect.appendChild(opt);
      }
    });
  };

  // Save
  saveBtn.onclick = () => {
    const pid = playerSelect.value;
    const chosen = posSelect.value;
    if (!pid || !chosen) return;

    // If player already in a different position, end that session & remove
    for (const pos of Object.keys(assignments)) {
      if (assignments[pos] === pid) {
        endPlayerSessionIfActive(pid);
        delete assignments[pos];
      }
    }

    // If replacing someone, end their session
    const replacedPid = assignments[chosen];
    if (replacedPid) endPlayerSessionIfActive(replacedPid);

    // Assign
    assignments[chosen] = pid;

    // Start this player's session if clock is running
    beginPlayerSessionIfRunning(pid);

    persist();
    renderAll();
    closeAssignModal();
  };

  // Unassign
  unassignBtn.onclick = () => {
    const pid = playerSelect.value;
    const at = currentPositionOf(pid);
    if (at) {
      endPlayerSessionIfActive(pid);
      delete assignments[at];
      persist();
      renderAll();
    }
    closeAssignModal();
  };

  // Cancel / open
  cancelBtn.onclick = closeAssignModal;
  backdrop.style.display = "flex";
  playerSelect.focus();
}

function closeAssignModal() {
  backdrop.style.display = "none";
}

/*************************
 * Bootstrap
 *************************/
document.addEventListener("DOMContentLoaded", () => {
  // Cache DOM
  allPlayersDiv      = document.getElementById("all-players");
  presentPlayersDiv  = document.getElementById("present-players");
  lineupDiv          = document.getElementById("lineup");
  formationSelect    = document.getElementById("formation-select");
  orientationSelect  = document.getElementById("orientation-select");

  clockDisplay   = document.getElementById("clock-display");
  clockStartBtn  = document.getElementById("clock-start");
  clockPauseBtn  = document.getElementById("clock-pause");
  clockResetBtn  = document.getElementById("clock-reset");

  backdrop     = document.getElementById("backdrop");
  assignTitle  = document.getElementById("assign-title");
  playerSelect = document.getElementById("player-select");
  posSelect    = document.getElementById("pos-select");
  saveBtn      = document.getElementById("save-btn");
  cancelBtn    = document.getElementById("cancel-btn");
  unassignBtn  = document.getElementById("unassign-btn");

  // Initialize selectors from saved state
  if (formationSelect) {
    formationSelect.value = currentFormation;
    formationSelect.addEventListener("change", (e) => changeFormation(e.target.value));
  }
  if (orientationSelect) {
    orientationSelect.value = orientation;
    orientationSelect.addEventListener("change", (e) => {
      orientation = e.target.value;
      persist();
      renderAll();
    });
  }

  // Clock handlers + initial UI
  if (clockStartBtn && clockPauseBtn && clockResetBtn) {
    clockStartBtn.addEventListener("click", startClock);
    clockPauseBtn.addEventListener("click", pauseClock);
    clockResetBtn.addEventListener("click", resetClock);
  }
  updateClockUI();
  startTickingIfNeeded();

  // First render
  renderAll();
});
