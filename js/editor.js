/**
 * Editor - 캔버스 클릭/드래그, 모드 전환 관리
 */

class Editor {
    constructor(canvasId, noteData, renderer, undoManager, clipboardManager, audioPlayer) {
        this.canvas = document.getElementById(canvasId);
        this.noteData = noteData;
        this.renderer = renderer;
        this.undoManager = undoManager;
        this.clipboardManager = clipboardManager;
        this.audioPlayer = audioPlayer;

        // 상태 변수
        this.mainMode = 'draw';        // draw, erase
        this.currentMode = 'normal';   // normal, long, drag (보조)
        this.currentLaneIndex = 1;     // 1, 2, 3 (보조)

        this.isDragging = false;
        this.dragStartAbsSlot = -1;
        this.dragStartLaneName = '';
        this.lastDrawnSlot = -1; // 드래그 중 중복 그리기 방지용
        
        // 키보드 노트 입력 상태 추적용
        this.keyStates = {};
        this.noteStartSlots = {};

        this.bindEvents();
    }

    setMainMode(mode) {
        this.mainMode = mode; // draw or erase
    }

    setMode(mode) {
        this.currentMode = mode; // normal, long, drag
    }

    setLane(laneIdx) {
        this.currentLaneIndex = laneIdx;
    }

    // 클릭 위치에서 편집 대상 laneName을 결정 (직접 그리기)
    // 마우스가 위치한 열(laneIdx)을 바탕으로 현재 보조 모드(normal/long/drag)에 맞는 lane 반환
    getTargetLaneName(laneIdx) {
        if (laneIdx < 0) return null;
        const laneName = this.renderer.laneNames[laneIdx]; // 예: normal_1, long_2 등
        
        // 클릭한 열에 바로 그리기를 위해, 클릭한 레인의 종류(normal/long/drag)는 무시하고,
        // 보조 모드에서 선택한 타입(normal/long/drag) + 클릭한 열의 숫자 인덱스를 조합할 수도 있고,
        // 아니면 "클릭한 레인의 이름 그대로" 쓸 수도 있습니다.
        // 현재는 "마우스가 위치한 레인 자체에 그린다"는 직접 그리기 방식 채택.
        return laneName; 
    }

    // 마우스 이벤트 -> laneName, absSlot 변환
    getSlotInfoFromEvent(evt) {
        const rect = this.canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;

        const laneIdx = this.renderer.getLaneFromX(x);
        const absSlot = this.renderer.getSlotFromY(y);

        let laneName = null;
        if (laneIdx >= 0) {
            laneName = this.renderer.laneNames[laneIdx];
        }

        return { laneName, absSlot, laneIdx, y };
    }

    bindEvents() {
        // 단축키 (Undo, Redo, Copy, Paste)
        window.addEventListener('keydown', (e) => {
            // 입력창 등에서 타이핑 중일 땐 무시
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) this.undoManager.redo();
                else this.undoManager.undo();
                e.preventDefault();
            } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
                this.undoManager.redo();
                e.preventDefault();
            }

            // 노트 입력 단축키 (A, S, D, F, G, H, J, K, L)
            const key = e.key.toLowerCase();
            const validKeys = ['a','s','d','f','g','h','j','k','l'];
            
            if (validKeys.includes(key) && !e.ctrlKey && !e.altKey) {
                if (!this.keyStates[key]) {
                    this.keyStates[key] = true;
                    this.handleNoteKeyDown(key);
                }
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            const key = e.key.toLowerCase();
            if (this.keyStates[key]) {
                this.keyStates[key] = false;
                this.handleNoteKeyUp(key);
            }
        });

        // 스크롤 및 줌
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.ctrlKey || e.shiftKey) {
                let delta = e.deltaY > 0 ? -2 : 2;
                this.renderer.setZoom(delta);
            } else {
                this.renderer.scroll(e.deltaY);
            }
        });

        // 클릭 다운
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // 1. 마디 영역 클릭 확인 (재생 연동)
            const clickedMeasure = this.renderer.getMeasureFromClick(x, y);
            if (clickedMeasure !== -1) {
                if (this.audioPlayer) {
                    this.audioPlayer.play(clickedMeasure);
                }
                return; // 마디 클릭 시 노트 편집은 무시
            }
            
            const info = this.getSlotInfoFromEvent(e);
            if (!info.laneName) return;

            // 편집 시작 전 Undo 스냅샷 저장
            if (this.undoManager) this.undoManager.saveState();

            // 지우개 모드
            if (this.mainMode === 'erase' || this.currentMode === 'delete') {
                let { measureIndex, slotIndex } = this.noteData.getMeasureAndSlotFromAbsolute(info.absSlot);
                this.noteData.setSlot(info.laneName, measureIndex, slotIndex, '0');
                this.isDragging = true;
                this.dragStartAbsSlot = info.absSlot;
                this.dragStartLaneName = info.laneName;
                this.lastDrawnSlot = info.absSlot;
                this.renderer.render();
                return;
            }

            // 그리기 모드
            const targetLane = info.laneName; // 직접 그리기: 마우스 위치 레인 사용
            if (!targetLane) return;
            
            const type = targetLane.split('_')[0];

            if (type === 'normal') {
                // 일반 노트는 토글이 아니라 "그리기(1) 설정"으로 변경하여 드래그 시 편의성 증대
                // 단, 토글이 편할 수도 있으므로 클릭한 곳이 이미 1이면 0으로, 아니면 1로 설정
                let { measureIndex, slotIndex } = this.noteData.getMeasureAndSlotFromAbsolute(info.absSlot);
                const currentVal = this.noteData.getMeasureData(targetLane, measureIndex)[slotIndex];
                const newVal = currentVal === '1' ? '0' : '1';
                
                this.noteData.setSlot(targetLane, measureIndex, slotIndex, newVal);
                this.isDragging = true;
                this.dragStartAbsSlot = info.absSlot; // 드래그 시 채우기 용도
                this.dragStartLaneName = targetLane;
                this.lastDrawnSlot = info.absSlot;
                this.renderer.render();
            } 
            else if (type === 'long' || type === 'drag') {
                this.isDragging = true;
                this.dragStartAbsSlot = info.absSlot;
                this.dragStartLaneName = targetLane;
            }
        });

        // 마우스 무브
        this.canvas.addEventListener('mousemove', (e) => {
            const info = this.getSlotInfoFromEvent(e);
            
            // 정보 패널 업데이트
            const infoLabel = document.getElementById('mouse-info');
            if (info.laneName && info.absSlot >= 0) {
                let { measureIndex, slotIndex } = this.noteData.getMeasureAndSlotFromAbsolute(info.absSlot);
                infoLabel.innerText = `Lane: ${info.laneName}\nMeasure: #${measureIndex}\nSlot: ${slotIndex}`;
            } else {
                infoLabel.innerText = '-';
            }

            if (this.isDragging) {
                // 현재 슬롯이 이전 처리 슬롯과 같다면 무시
                if (this.lastDrawnSlot === info.absSlot && this.currentMode !== 'long' && this.currentMode !== 'drag') {
                    return;
                }
                
                // 지우개 모드 드래그
                if (this.mainMode === 'erase' || this.currentMode === 'delete') {
                    if (this.dragStartLaneName) {
                        this.noteData.setRange(this.dragStartLaneName, this.dragStartAbsSlot, info.absSlot, '0');
                        this.renderer.render();
                        this.lastDrawnSlot = info.absSlot;
                    }
                }
                // 그리기 모드 드래그
                else if (this.mainMode === 'draw' && this.dragStartLaneName) {
                    const type = this.dragStartLaneName.split('_')[0];
                    if (type === 'normal') {
                        // 일반노트는 드래그 시 지나간 경로를 채우기
                        this.noteData.setRange(this.dragStartLaneName, Math.min(this.lastDrawnSlot, info.absSlot), Math.max(this.lastDrawnSlot, info.absSlot), '1');
                        this.renderer.render();
                        this.lastDrawnSlot = info.absSlot;
                    } else {
                        // 롱/드래그는 시작점부터 현재위치까지 박스형태로 채움
                        // (기존 노트데이터를 보존하기 위해 그려지는 동안은 지우지 않고 덮어씀, 이부분은 최적화 필요 시 임시 캔버스 활용가능하나 현 구조 유지)
                        this.noteData.setRange(this.dragStartLaneName, this.dragStartAbsSlot, info.absSlot, '1');
                        this.renderer.render();
                        this.lastDrawnSlot = info.absSlot;
                    }
                }
            }
        });

        // 드래그 종료
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.dragStartAbsSlot = -1;
                this.dragStartLaneName = '';
                this.renderer.render();
            }
        });
    }

    handleNoteKeyDown(key) {
        if (this.renderer.currentPlaybackSlot === null) return; // 재생/일시정지 위치가 없을 땐 무시
        
        // 부동 소수점 인덱스로 배열에 접근하는 것을 방지하기 위해 정수로 반올림
        const absSlot = Math.round(this.renderer.currentPlaybackSlot);
        const { measureIndex, slotIndex } = this.noteData.getMeasureAndSlotFromAbsolute(absSlot);

        this.undoManager.saveState();

        switch(key) {
            case 'a': this.noteData.setSlot('normal_1', measureIndex, slotIndex, '1'); break;
            case 's': this.noteData.setSlot('normal_2', measureIndex, slotIndex, '1'); break;
            case 'd': this.noteData.setSlot('normal_3', measureIndex, slotIndex, '1'); break;
            
            case 'f': this.noteStartSlots['long_1'] = absSlot; break;
            case 'g': this.noteStartSlots['long_2'] = absSlot; break;
            case 'h': this.noteStartSlots['long_3'] = absSlot; break;
            
            case 'j': this.noteStartSlots['drag_1'] = absSlot; break;
            case 'k': this.noteStartSlots['drag_2'] = absSlot; break;
            case 'l': this.noteStartSlots['drag_3'] = absSlot; break;
        }
        this.renderer.render();
    }

    handleNoteKeyUp(key) {
        if (this.renderer.currentPlaybackSlot === null) return;
        
        const absSlot = Math.round(this.renderer.currentPlaybackSlot);

        const map = {
            'f': { lane: 'long_1', type: 'long' },
            'g': { lane: 'long_2', type: 'long' },
            'h': { lane: 'long_3', type: 'long' },
            'j': { lane: 'drag_1', type: 'drag' },
            'k': { lane: 'drag_2', type: 'drag' },
            'l': { lane: 'drag_3', type: 'drag' }
        };

        if (map[key]) {
            const config = map[key];
            const startSlot = this.noteStartSlots[config.lane];
            if (startSlot !== undefined) {
                const endSlot = absSlot;
                
                // 순서 보장 (무조건 위에서 아래로)
                const s = Math.min(startSlot, endSlot);
                const e = Math.max(startSlot, endSlot);
                
                if (config.type === 'long') {
                    this.noteData.setLongDragRange(config.lane, s, e, '2', '3', '4');
                } else if (config.type === 'drag') {
                    this.noteData.setLongDragRange(config.lane, s, e, '5', '6', '5'); // 드래그는 머리/꼬리가 5
                }
                
                delete this.noteStartSlots[config.lane];
                this.renderer.render();
            }
        }
    }
}
