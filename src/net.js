// 친구와 함께 달리기: 방 코드(초대 링크)로 PeerJS P2P 연결을 해요. 가입·서버 필요 없어요.
// 방을 처음 연 사람이 '중계'를 맡고, 나머지는 중계에 붙어서 차 위치와 레이스 상태를 주고받아요.

const round = (v, k = 100) => Math.round(v * k) / k;
const PREFIX = 'f1-bahrain-room-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const NAME_KEY = 'f1-bahrain-name';

export class Net {
  constructor() {
    this.room = null;       // 개발용 가짜 방 (mockpeer)
    this.ready = false;     // 방 연결 완료 여부
    this.peers = [];        // 나를 뺀 다른 참가자들
    this.me = null;         // 나
    this.state = {};        // 내가 보내는 presence
    this.sendT = 0;
    this.listeners = [];
    this.code = null;       // 방 코드
    this.peer = null;       // PeerJS 연결
    this.isRelay = false;   // 내가 중계를 맡았는지
    this.relayConn = null;  // 중계로 가는 연결 (참가자일 때)
    this.conns = new Map(); // 참가자들 연결 (중계일 때)
    this.others = new Map();
    this.dirtyAll = false;
    try { this.myName = localStorage.getItem(NAME_KEY) || ''; } catch { this.myName = ''; }
  }

  async init() {
    if (new URLSearchParams(location.search).has('mockpeer')) return this.initMock();
    const code = new URLSearchParams(location.search).get('room');
    if (code) this.connect(code);
    return typeof Peer !== 'undefined';
  }

  /** 레이스 모드에 들어갈 때: 방이 없으면 새로 만들어요 */
  ensureRoom() {
    if (this.room || this.code) return;
    this.connect(makeCode());
  }

  inviteLink() {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('room', this.code);
    return url.toString();
  }

  askName() {
    if (this.myName) return;
    const n = (prompt('레이스에서 쓸 이름을 입력하세요', '') || '').trim().slice(0, 12);
    this.myName = n;
    try { localStorage.setItem(NAME_KEY, n); } catch { /* 저장 불가 환경 */ }
  }

  /** 방 코드로 연결: 그 방에 아무도 없으면 내가 중계를 맡고, 있으면 참가해요 */
  connect(code) {
    if (typeof Peer === 'undefined') return;
    code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) return;
    this.leave();
    this.code = code;
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    const peer = new Peer(PREFIX + code);
    this.peer = peer;
    peer.on('open', (id) => {
      this.isRelay = true;
      this.me = { peer: id, sameTab: true, isMe: true };
      this.ready = true;
      this.dirty = true;
    });
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => {
        if (!msg || msg.t !== 'p') return;
        this.conns.set(conn.peer, conn);
        this.others.set(conn.peer, { peer: conn.peer, name: String(msg.n || '').slice(0, 12), presence: msg.p || {}, updatedAt: Date.now() });
        this.syncPeers();
        this.dirtyAll = true;
      });
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        this.others.delete(conn.peer);
        this.syncPeers();
        this.dirtyAll = true;
      });
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && this.peer === peer) { peer.destroy(); this.join(code); }
    });
  }

  join(code) {
    const peer = new Peer();
    this.peer = peer;
    peer.on('open', (id) => {
      this.me = { peer: id, sameTab: true, isMe: true };
      const conn = peer.connect(PREFIX + code);
      conn.on('open', () => { this.relayConn = conn; this.ready = true; this.dirty = true; });
      conn.on('data', (msg) => {
        if (!msg || msg.t !== 'all' || !Array.isArray(msg.list)) return;
        const now = Date.now();
        this.others = new Map(msg.list.filter((p) => p.peer !== id).map((p) => [p.peer, { ...p, updatedAt: now }]));
        this.syncPeers();
      });
      // 중계가 나가면 같은 방 코드로 다시 연결해요 (먼저 들어온 사람이 새 중계가 돼요)
      conn.on('close', () => { if (this.peer === peer) setTimeout(() => this.peer === peer && this.connect(code), 500 + Math.random() * 1500); });
    });
    peer.on('error', () => { this.ready = false; });
  }

  leave() {
    if (this.peer) this.peer.destroy();
    this.peer = this.relayConn = null;
    this.isRelay = this.ready = false;
    this.conns.clear();
    this.others.clear();
    this.syncPeers();
  }

  syncPeers() {
    this.peers = [...this.others.values()].map((p) => ({
      peer: p.peer, name: p.name, presence: Object.freeze(p.presence || {}), updatedAt: p.updatedAt,
      by: null, sameTab: false, kind: 'viewer',
    }));
    this.listeners.forEach((fn) => fn({ peers: this.peers }));
  }

  send() {
    if (this.room) { this.room.presence({ ...this.state }).catch(() => {}); return; }
    if (this.isRelay) {
      const list = [{ peer: this.me.peer, name: this.myName, presence: { ...this.state } }, ...[...this.others.values()].map((p) => ({ peer: p.peer, name: p.name, presence: p.presence }))];
      this.conns.forEach((c) => { if (c.open) c.send({ t: 'all', list }); });
    } else if (this.relayConn && this.relayConn.open) {
      this.relayConn.send({ t: 'p', n: this.myName, p: { ...this.state } });
    }
  }

  /** 개발용: 가짜 친구 한 명이 대기실에서 준비하고, 레이스가 시작되면 천천히 달려요 */
  initMock() {
    this.ready = true;
    const me = { peer: 'a-me', by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: {}, updatedAt: Date.now() };
    let friend = { peer: 'z-friend', by: null, isMe: false, sameTab: false, kind: 'viewer', guest: true, updatedAt: Date.now(),
      presence: Object.freeze({ mode: 'race', phase: 'lobby', ready: true }) };
    let raceStart = 0, rid = null;
    this.room = {
      presence: async (st) => {
        me.presence = st;
        if (st.start && st.start.id !== rid) { rid = st.start.id; raceStart = st.start.at; }
      },
    };
    this.me = me;
    setInterval(() => {
      const t = (Date.now() - raceStart) / 1000;
      const pr = rid && t > 0
        ? { mode: 'race', phase: 'race', rid, rp: [rid, Math.round(t * 48 - 30), null] }
        : { mode: 'race', phase: 'lobby', ready: true };
      const mine = this.state.c;
      if (mine) pr.c = [mine[0] + Math.cos(mine[2]) * 5 + Math.sin(mine[2]) * 6, mine[1] - Math.sin(mine[2]) * 5 + Math.cos(mine[2]) * 6, mine[2], mine[3], mine[4], 0.05, mine[6]];
      friend = { ...friend, presence: Object.freeze(pr), updatedAt: Date.now() };
      this.peers = [friend];
    }, 100);
    this.peers = [friend];
    if (new URLSearchParams(location.search).has('autoready')) setTimeout(() => { this.state.ready = true; this.dirty = true; }, 500);
    return Promise.resolve(true);
  }

  onChange(fn) { this.listeners.push(fn); }

  nameOf(peer, i = 0) {
    return peer.name || `플레이어 ${i + 1}`;
  }

  /** 내 상태 일부를 바꿔요 (보내기는 tick에서 묶어서) */
  set(patch) {
    Object.assign(this.state, patch);
    this.dirty = true;
  }

  /** 차 상태는 초당 20번까지만 보내요 */
  tick(dt, phys) {
    if (!this.ready) return;
    this.sendT -= dt;
    if (phys && this.state.mode && this.state.mode !== 'menu') {
      const { vx, vz } = phys.worldVel();
      this.state.c = [round(phys.x), round(phys.z), round(phys.yaw, 1000), round(vx), round(vz), round(phys.steer, 1000), round(phys.speed), round(phys.brake, 10)];
      this.dirty = true;
    } else if (this.state.c) {
      this.state.c = null;
      this.dirty = true;
    }
    if (this.sendT <= 0 && (this.dirty || this.dirtyAll)) {
      this.sendT = 0.05;
      this.dirty = this.dirtyAll = false;
      this.send();
    }
  }
}
