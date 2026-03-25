# SPECODE Design System — 컴포넌트 사용 가이드
> DS_COMPONENTS.md | Claude Code 참조용

---

## 앱 크롬 (App Chrome)

### Titlebar
```html
<div class="sp-titlebar">
  <div class="sp-titlebar-left">
    <div class="sp-titlebar-logo">
      <div class="logo-ic">⚡</div>
      SPECODE
    </div>
    <span class="sp-titlebar-sep">/</span>
    <span class="sp-titlebar-path">페이지명</span>
  </div>
  <div class="sp-titlebar-right">
    <div class="sp-win-btn">─</div>
    <div class="sp-win-btn">□</div>
    <div class="sp-win-btn is-close">✕</div>
  </div>
</div>
```

### Menubar
```html
<div class="sp-menubar">
  <div class="sp-menu-item is-active">File</div>
  <div class="sp-menu-item">Edit</div>
  <div class="sp-menu-sep"></div>
  <div class="sp-menu-item">Help</div>
</div>
```

### Toolbar
```html
<div class="sp-toolbar">
  <div class="sp-toolbar-btn is-primary">
    <svg>...</svg> Save
  </div>
  <div class="sp-toolbar-sep"></div>
  <div class="sp-toolbar-btn">Deploy</div>
  <div class="sp-toolbar-space"></div>
  <div class="sp-toolbar-info">Branch: main</div>
</div>
```

### Sidebar
```html
<aside class="sp-sidebar" id="sidebar">
  <div class="sp-sidebar-toggle" onclick="toggleSidebar()">
    <svg>...</svg>
  </div>
  <div class="sp-sidebar-section">
    <div class="sp-sidebar-title">섹션명</div>
    <div class="sp-sidebar-item is-active" data-label="메뉴명">
      <svg>...</svg>
      <span>메뉴명</span>
    </div>
    <div class="sp-sidebar-item" data-label="메뉴2">
      <svg>...</svg>
      <span>메뉴2</span>
    </div>
  </div>
</aside>

<script>
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('is-collapsed');
}
</script>
```

### Statusbar
```html
<div class="sp-statusbar">
  <div class="sp-status-cell is-ok"><span class="dot"></span>Connected</div>
  <div class="sp-status-cell is-warn"><span class="dot"></span>경고 1건</div>
  <div class="sp-status-cell">v2.4.1</div>
  <div class="sp-status-space"></div>
  <div class="sp-status-cell">UTF-8</div>
</div>
```
- 상태 클래스: `is-ok` / `is-warn` / `is-err`

---

## GroupBox (Win32 DNA 핵심)

```html
<div class="sp-group">
  <div class="sp-group-header">
    <div class="sp-group-title">
      <svg>...</svg>
      섹션 제목
    </div>
    <span class="sp-badge sp-badge-neutral">REQUIRED</span>
  </div>
  <div class="sp-group-body">
    <!-- 컨텐츠 -->
  </div>
</div>
```

---

## Buttons

```html
<!-- Variants -->
<button class="sp-btn sp-btn-primary">저장</button>
<button class="sp-btn sp-btn-accent">+ 추가</button>
<button class="sp-btn sp-btn-secondary">취소</button>
<button class="sp-btn sp-btn-ghost">더보기</button>
<button class="sp-btn sp-btn-danger">삭제</button>
<button class="sp-btn sp-btn-success">완료</button>

<!-- Sizes -->
<button class="sp-btn sp-btn-primary sp-btn-xl">XL</button>
<button class="sp-btn sp-btn-primary sp-btn-lg">LG</button>
<button class="sp-btn sp-btn-primary">MD (default)</button>
<button class="sp-btn sp-btn-primary sp-btn-sm">SM</button>
<button class="sp-btn sp-btn-primary sp-btn-xs">XS</button>

<!-- Icon only -->
<button class="sp-btn sp-btn-secondary sp-btn-icon">
  <svg>...</svg>
</button>

<!-- Full width -->
<button class="sp-btn sp-btn-primary sp-btn-full">전체 너비</button>

<!-- Disabled -->
<button class="sp-btn sp-btn-primary" disabled>비활성</button>

<!-- Button row with spacer -->
<div class="sp-btn-row">
  <button class="sp-btn sp-btn-primary">저장</button>
  <button class="sp-btn sp-btn-secondary">취소</button>
  <div class="sp-btn-row-spacer"></div>
  <button class="sp-btn sp-btn-danger">삭제</button>
</div>
```

---

## Badges

```html
<span class="sp-badge sp-badge-brand"><span class="dot"></span>Running</span>
<span class="sp-badge sp-badge-success"><span class="dot"></span>Passed</span>
<span class="sp-badge sp-badge-error"><span class="dot"></span>Failed</span>
<span class="sp-badge sp-badge-warning"><span class="dot"></span>Pending</span>
<span class="sp-badge sp-badge-info">Review</span>
<span class="sp-badge sp-badge-neutral">Draft</span>
<span class="sp-badge sp-badge-accent">Required</span>

<!-- Pill shape -->
<span class="sp-badge sp-badge-success sp-badge-pill">완료</span>
```

---

## Inputs — Top Label

```html
<!-- 기본 -->
<div class="sp-field">
  <div class="sp-label">
    필드명 <span class="sp-label-req">필수</span>
  </div>
  <input class="sp-input" type="text" placeholder="입력">
</div>

<!-- 선택 라벨 -->
<div class="sp-label">
  필드명 <span class="sp-label-opt">선택</span>
</div>

<!-- 성공 상태 -->
<div class="sp-field">
  <div class="sp-label">이메일</div>
  <input class="sp-input is-ok" type="text" value="admin@specode.io">
  <div class="sp-hint is-ok">
    <svg>...</svg> 확인됨
  </div>
</div>

<!-- 오류 상태 -->
<div class="sp-field">
  <div class="sp-label">API Key</div>
  <input class="sp-input is-err" type="text">
  <div class="sp-hint is-err">
    <svg>...</svg> 오류 메시지
  </div>
</div>

<!-- 경고 힌트 -->
<div class="sp-hint is-warn">경고 메시지</div>

<!-- 아이콘 인풋 -->
<div class="sp-input-wrap">
  <div class="sp-input-icon">
    <svg>...</svg>
  </div>
  <input class="sp-input" type="text" placeholder="검색...">
</div>

<!-- 액션 버튼 (비밀번호 눈 등) -->
<div class="sp-input-wrap">
  <input class="sp-input" type="password" id="pw">
  <button class="sp-input-action" onclick="...">
    <svg>...</svg>
  </button>
</div>

<!-- Select -->
<div class="sp-select-wrap">
  <select class="sp-input">
    <option>옵션1</option>
    <option>옵션2</option>
  </select>
  <div class="sp-select-arrow">
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6">
      <polyline points="2,4 6,8 10,4"/>
    </svg>
  </div>
</div>

<!-- Textarea -->
<textarea class="sp-input sp-textarea" placeholder="입력..."></textarea>

<!-- 필드 가로 배치 -->
<div class="sp-field-row">
  <div class="sp-field"><input class="sp-input" type="text"></div>
  <div class="sp-field" style="flex:0 0 120px"><input class="sp-input" type="text"></div>
</div>
```

---

## Inputs — Inline Label (DB 폼 등)

```html
<!-- 기본 -->
<div class="sp-field-inline">
  <div class="sp-inline-label">HOST</div>
  <input class="sp-inline-input" type="text" placeholder="입력">
</div>

<!-- 성공 -->
<div class="sp-field-inline is-ok">
  <div class="sp-inline-label">EMAIL</div>
  <input class="sp-inline-input" type="text" value="admin@specode.io">
</div>

<!-- 오류 -->
<div class="sp-field-inline is-err">
  <div class="sp-inline-label">API KEY</div>
  <input class="sp-inline-input" type="text">
</div>

<!-- Select -->
<div class="sp-field-inline">
  <div class="sp-inline-label">SSL MODE</div>
  <div class="sp-inline-select-wrap">
    <select>
      <option>require</option>
      <option>verify-full</option>
    </select>
    <div class="sp-inline-select-arrow">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6">
        <polyline points="2,4 6,8 10,4"/>
      </svg>
    </div>
  </div>
</div>

<!-- 가로 배치 (HOST + PORT) -->
<div style="display:flex;gap:8px">
  <div style="flex:1">
    <div class="sp-field-inline">
      <div class="sp-inline-label">HOST</div>
      <input class="sp-inline-input" type="text">
    </div>
  </div>
  <div style="width:160px">
    <div class="sp-field-inline">
      <div class="sp-inline-label">PORT</div>
      <input class="sp-inline-input" type="text">
    </div>
  </div>
</div>
```

---

## Toggle

```html
<!-- Track only -->
<div class="sp-toggle-track is-on" onclick="this.classList.toggle('is-on')"></div>
<div class="sp-toggle-track" onclick="this.classList.toggle('is-on')"></div>

<!-- Toggle Row (설정 패널) -->
<div class="sp-toggle-row" onclick="this.querySelector('.sp-toggle-track').classList.toggle('is-on')">
  <div class="sp-toggle-row-info">
    <p>Auto-deploy on push</p>
    <span>main 브랜치 머지 시 자동 배포</span>
  </div>
  <div class="sp-toggle-track is-on"></div>
</div>
```

---

## Checkbox

```html
<label class="sp-checkbox-wrap">
  <input class="sp-checkbox" type="checkbox" checked>
  <span>[필수] 이용약관에 동의합니다</span>
</label>

<label class="sp-checkbox-wrap">
  <input class="sp-checkbox" type="checkbox" disabled>
  <span style="opacity:0.45">비활성</span>
</label>
```

---

## Radio Group

```html
<div class="sp-radio-group">
  <div class="sp-radio-option is-selected" onclick="selectRadio(this)">Dev</div>
  <div class="sp-radio-option" onclick="selectRadio(this)">Staging</div>
  <div class="sp-radio-option" onclick="selectRadio(this)">Production</div>
</div>

<script>
function selectRadio(el) {
  el.closest('.sp-radio-group').querySelectorAll('.sp-radio-option')
    .forEach(o => o.classList.remove('is-selected'));
  el.classList.add('is-selected');
}
</script>
```

---

## Data Table

```html
<div class="sp-table-wrap">
  <table class="sp-table">
    <thead>
      <tr>
        <th>Pipeline</th>
        <th class="is-sorted">Status ↑</th>
        <th>Duration</th>
        <th>Triggered</th>
      </tr>
    </thead>
    <tbody>
      <tr class="is-selected">
        <td>build-prod-v241</td>
        <td><span class="sp-badge sp-badge-success"><span class="dot"></span>Passed</span></td>
        <td class="is-mono">2m 14s</td>
        <td class="is-mono">10:32 AM</td>
      </tr>
      <tr>
        <td>build-prod-v240</td>
        <td><span class="sp-badge sp-badge-error"><span class="dot"></span>Failed</span></td>
        <td class="is-mono">0m 48s</td>
        <td class="is-mono is-muted">09:18 AM</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- td 클래스 -->
<!-- is-mono : 모노스페이스 (수치, 코드) -->
<!-- is-muted : 연한 색 (부가 정보) -->
```

---

## Tabs

```html
<!-- Line tabs -->
<div class="sp-tab-bar">
  <div class="sp-tab is-active">내용</div>
  <div class="sp-tab">히스토리</div>
  <div class="sp-tab">설정</div>
</div>

<!-- Segmented tabs -->
<div class="sp-tab-seg">
  <div class="sp-tab-seg-item is-active">개요</div>
  <div class="sp-tab-seg-item">설정</div>
</div>
```

---

## Misc

```html
<!-- Divider -->
<div class="sp-divider"></div>

<!-- Section title (uppercase label) -->
<div class="sp-section-title">섹션명</div>

<!-- Keyboard shortcut -->
<span class="sp-kbd">⌘S</span>
<span class="sp-kbd">Ctrl+K</span>

<!-- Inline code -->
<code class="sp-code">sp-btn</code>

<!-- Avatar -->
<div class="sp-avatar sp-avatar-md">GS</div>
<!-- sizes: sp-avatar-sm / sp-avatar-md / sp-avatar-lg / sp-avatar-xl -->

<!-- Spinner -->
<div class="sp-spinner"></div>
<div class="sp-spinner sp-spinner-lg"></div>

<!-- Empty state -->
<div class="sp-empty">
  <div class="sp-empty-icon">📄</div>
  <div class="sp-empty-title">문서 없음</div>
  <div class="sp-empty-desc">이 카테고리에 문서가 없습니다.</div>
  <button class="sp-btn sp-btn-primary sp-btn-sm">+ 추가</button>
</div>
```

---

## Toast

```html
<div class="sp-toast is-success">
  <div class="sp-toast-icon">✅</div>
  <div class="sp-toast-content">
    <div class="sp-toast-title">배포 완료</div>
    <div class="sp-toast-desc">build-prod-v241 성공 (2m 14s)</div>
  </div>
  <div class="sp-toast-close">✕</div>
</div>
<!-- 상태: is-success / is-error / is-warning / is-info -->
```

---

## 공통 상태 클래스 요약

| 클래스 | 의미 | 사용처 |
|---|---|---|
| `is-active` | 활성 선택됨 | sidebar-item, menu-item, tab |
| `is-on` | 켜진 상태 | toggle-track |
| `is-selected` | 선택됨 | radio-option, table tr |
| `is-ok` | 성공/정상 | input, field-inline, hint |
| `is-err` | 오류 | input, field-inline, hint |
| `is-warn` | 경고 | hint |
| `is-sorted` | 정렬 기준 | table th |
| `is-mono` | 모노스페이스 | table td |
| `is-collapsed` | 접힘 | sidebar |
| `is-primary` | 강조 | toolbar-btn |
| `is-close` | 닫기 스타일 | win-btn |
