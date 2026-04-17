/**
 * GridRenderer - Canvas 기반의 에디터 그리드 및 노트 렌더링
 */

class GridRenderer {
    constructor(canvasId, noteData) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.noteData = noteData;

        this.width = 800;
        this.height = 600;
        this.dpr = window.devicePixelRatio || 1;

        this.laneNames = [
            'normal_1', 'normal_2', 'normal_3',
            'long_1', 'long_2', 'long_3',
            'drag_1', 'drag_2', 'drag_3'
        ];
        this.laneWidth = 60;
        this.measureLabelWidth = 60;
        this.defaultSlotHeight = 30;
        this.slotHeight = 30;
        this.scrollY = 0;

        this.init();
    }

    init() {
        this._doResize();
        window.addEventListener('resize', () => this._doResize());
    }

    _doResize() {
        const container = this.canvas.parentElement;
        this.width = container.clientWidth;
        this.height = container.clientHeight;
        if (this.width <= 0 || this.height <= 0) return;

        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;

        this.render();
    }

    setZoom(delta) {
        this.slotHeight += delta;
        if (this.slotHeight < 1) this.slotHeight = 1;
        if (this.slotHeight > 120) this.slotHeight = 120;
        this.updateZoomUI();
        this.render();
    }

    setSlotHeight(h) {
        this.slotHeight = h;
        if (this.slotHeight < 1) this.slotHeight = 1;
        if (this.slotHeight > 120) this.slotHeight = 120;
        this.updateZoomUI();
        this.render();
    }

    // 전체 마디를 화면에 맞추기
    zoomFit() {
        const totalSlots = this.noteData.totalMeasures * this.noteData.slotsPerMeasure;
        if (totalSlots <= 0) return;
        this.slotHeight = Math.max(1, this.height / totalSlots);
        this.scrollY = 0;
        this.updateZoomUI();
        this.render();
    }

    getZoomPercent() {
        return Math.round((this.slotHeight / this.defaultSlotHeight) * 100);
    }

    updateZoomUI() {
        const el = document.getElementById('zoom-level');
        if (el) el.textContent = this.getZoomPercent() + '%';
    }

    scroll(delta) {
        this.scrollY += delta;
        if (this.scrollY < 0) this.scrollY = 0;
        const totalHeight = this.noteData.totalMeasures * this.noteData.slotsPerMeasure * this.slotHeight;
        if (this.scrollY > totalHeight) this.scrollY = totalHeight;
        this.render();
    }

    // 특정 마디로 스크롤 (화면 중앙에 표시)
    scrollToMeasure(measureIndex) {
        const absSlot = this.noteData.getAbsoluteSlotIndex(measureIndex, 0);
        const targetY = absSlot * this.slotHeight;
        // 해당 마디가 화면 하단 1/3 지점에 오도록
        this.scrollY = targetY - this.height * 0.3;
        if (this.scrollY < 0) this.scrollY = 0;
        this.render();
    }

    getY(measureIndex, slotIndex) {
        const absSlot = this.noteData.getAbsoluteSlotIndex(measureIndex, slotIndex);
        const absoluteY = absSlot * this.slotHeight;
        return this.height - (absoluteY - this.scrollY);
    }

    getSlotFromY(y) {
        const absoluteY = this.height - y + this.scrollY;
        let absSlot = Math.round(absoluteY / this.slotHeight);
        if (absSlot < 0) absSlot = 0;
        return absSlot;
    }

    getLaneFromX(x) {
        const startX = this.getGridStartX();
        if (x < startX) return -1;
        const laneIndex = Math.floor((x - startX) / this.laneWidth);
        if (laneIndex >= 0 && laneIndex < this.laneNames.length) return laneIndex;
        return -1;
    }

    getGridStartX() {
        return Math.floor((this.width - (this.laneNames.length * this.laneWidth + this.measureLabelWidth)) / 2);
    }

    render() {
        const ctx = this.ctx;
        const dpr = this.dpr;

        // 변환 초기화 & 클리어
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);

        const gridStartX = this.getGridStartX();
        const gridEndX = gridStartX + (this.laneNames.length * this.laneWidth);

        // ===== 1. 그리드 가로선 =====
        ctx.lineWidth = 1;
        for (let m = 1; m <= this.noteData.totalMeasures; m++) {
            for (let s = 0; s < this.noteData.slotsPerMeasure; s++) {
                const y = this.getY(m, s);
                if (y < -50 || y > this.height + 50) continue;

                if (s === 0) {
                    ctx.strokeStyle = "rgba(255,255,255,0.5)";
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(gridStartX, y); ctx.lineTo(gridEndX, y); ctx.stroke();
                    ctx.lineWidth = 1;
                    ctx.fillStyle = "rgba(255,255,255,0.4)";
                    ctx.font = "12px monospace";
                    ctx.textAlign = "right";
                    ctx.fillText(`#${m.toString().padStart(3, '0')}`, gridEndX + this.measureLabelWidth - 10, y + 4);
                } else if (s % this.noteData.slotsPerBeat === 0) {
                    ctx.strokeStyle = "rgba(255,255,255,0.2)";
                    ctx.beginPath(); ctx.moveTo(gridStartX, y); ctx.lineTo(gridEndX, y); ctx.stroke();
                } else {
                    ctx.strokeStyle = "rgba(255,255,255,0.05)";
                    ctx.beginPath(); ctx.moveTo(gridStartX, y); ctx.lineTo(gridEndX, y); ctx.stroke();
                }
            }
        }

        // ===== 2. 세로선 (Lane 구분) =====
        for (let i = 0; i <= this.laneNames.length; i++) {
            const x = gridStartX + i * this.laneWidth;
            if (i === 0 || i === 3 || i === 6 || i === 9) {
                ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.4)";
            } else {
                ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.15)";
            }
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();

            if (i < this.laneNames.length) {
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.font = "10px sans-serif";
                ctx.textAlign = "center";
                const name = this.laneNames[i];
                const disp = name.startsWith("n") ? "Nml " + name.split('_')[1] :
                             name.startsWith("l") ? "Lng " + name.split('_')[1] :
                             "Drg " + name.split('_')[1];
                ctx.fillText(disp, x + this.laneWidth / 2, 15);
            }
        }

        // ===== 3. 노트 렌더링 =====
        let drawnCount = 0;

        for (let l = 0; l < this.laneNames.length; l++) {
            const laneName = this.laneNames[l];
            const laneX = gridStartX + l * this.laneWidth;
            const type = laneName.split('_')[0];

            let isHolding = false;
            let holdStartY = 0;

            for (let m = 1; m <= this.noteData.totalMeasures; m++) {
                // 직접 lanes 객체에서 데이터 읽기 (getMeasureData 우회 안 함)
                let mData = this.noteData.lanes[laneName][m];
                if (!mData) continue; // 이 마디에 저장된 데이터 없음 → 스킵

                for (let s = 0; s < mData.length; s++) {
                    if (mData[s] !== '1') {
                        // 롱/드래그 연속이 끊기는 지점 처리
                        if (isHolding && (type === 'long' || type === 'drag')) {
                            // 이전 슬롯이 끝이었음 → 바 그리기
                            const prevY = this.getY(m, s);
                            const topY = Math.min(holdStartY, prevY);
                            const h = Math.abs(holdStartY - prevY);
                            ctx.fillStyle = type === 'long' ? "rgba(0,230,118,0.7)" : "rgba(255,145,0,0.6)";
                            ctx.fillRect(laneX + 5, topY, this.laneWidth - 10, Math.max(h, 4));
                            isHolding = false;
                            drawnCount++;
                        }
                        continue;
                    }

                    // mData[s] === '1' 인 경우
                    const noteY = this.getY(m, s);

                    if (type === 'normal') {
                        // 화면 범위 체크
                        if (noteY >= -30 && noteY <= this.height + 30) {
                            ctx.fillStyle = "#ff3366";
                            const ch = Math.max(6, this.slotHeight * 0.4);
                            ctx.fillRect(laneX + 3, noteY - ch / 2, this.laneWidth - 6, ch);
                            drawnCount++;
                        }
                    } else if (type === 'long' || type === 'drag') {
                        if (!isHolding) {
                            isHolding = true;
                            holdStartY = noteY;
                        }
                        // 마디 끝이면서 다음 마디 첫 슬롯이 이어지지 않으면 바 닫기
                        let nextIs1 = false;
                        if (s + 1 < mData.length) {
                            nextIs1 = mData[s + 1] === '1';
                        } else if (m + 1 <= this.noteData.totalMeasures) {
                            const nextD = this.noteData.lanes[laneName][m + 1];
                            nextIs1 = nextD && nextD[0] === '1';
                        }
                        if (!nextIs1 && isHolding) {
                            const topY = Math.min(holdStartY, noteY);
                            const h = Math.abs(holdStartY - noteY);
                            ctx.fillStyle = type === 'long' ? "rgba(0,230,118,0.7)" : "rgba(255,145,0,0.6)";
                            ctx.fillRect(laneX + 5, topY, this.laneWidth - 10, Math.max(h, 4));
                            isHolding = false;
                            drawnCount++;
                        }
                    }
                }
            }
        }

        // ===== 4. 디버그 정보 표시 =====
        let totalNotes = 0;
        for (const lane of this.laneNames) {
            for (let m = 1; m <= this.noteData.totalMeasures; m++) {
                const d = this.noteData.lanes[lane][m];
                if (d) totalNotes += (d.match(/1/g) || []).length;
            }
        }
        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`Data: ${totalNotes} notes | Drawn: ${drawnCount} | Scroll: ${Math.round(this.scrollY)}`, 10, this.height - 8);
    }
}
