/**
 * ClipboardManager - 마디 데이터 복사/붙여넣기 시스템
 */

class ClipboardManager {
    constructor(noteData, renderer, undoManager) {
        this.noteData = noteData;
        this.renderer = renderer;
        this.undoManager = undoManager;
        
        this.clipboardData = null; // { measureCount: number, lanes: { [laneName]: [measureData1, measureData2, ...] } }
    }

    // start ~ end 범위의 마디를 클립보드에 복사
    copyMeasureRange(startMeasure, endMeasure) {
        const start = Math.min(startMeasure, endMeasure);
        const end = Math.max(startMeasure, endMeasure);
        const count = end - start + 1;

        if (start < 1 || end > this.noteData.totalMeasures) {
            this.showNotification("❌ 잘못된 마디 범위입니다.", true);
            return false;
        }

        const copiedData = {
            measureCount: count,
            lanes: {}
        };

        for (const lane in this.noteData.lanes) {
            copiedData.lanes[lane] = [];
            for (let m = start; m <= end; m++) {
                const measureData = this.noteData.getMeasureData(lane, m);
                copiedData.lanes[lane].push(measureData);
            }
        }

        this.clipboardData = copiedData;
        this.showNotification(`✅ 마디 ${start}~${end} (${count}개 마디) 복사됨`);
        console.log("[Clipboard] Copied", copiedData);
        return true;
    }

    // targetMeasure부터 클립보드의 마디들을 덮어쓰기
    pasteMeasure(targetMeasure) {
        if (!this.clipboardData) {
            this.showNotification("❌ 클립보드가 비어있습니다.", true);
            return false;
        }

        const count = this.clipboardData.measureCount;
        
        // 붙여넣기 전 Undo 스냅샷 저장
        if (this.undoManager) {
            this.undoManager.saveState();
        }

        // 대상 마디 범위를 초과하면 마디 수를 늘릴 수 없으므로(기본적으로) 자르기
        for (let i = 0; i < count; i++) {
            const m = targetMeasure + i;
            if (m > this.noteData.totalMeasures) break;

            for (const lane in this.clipboardData.lanes) {
                const dataStr = this.clipboardData.lanes[lane][i];
                if (dataStr) {
                    this.noteData.lanes[lane][m] = dataStr;
                }
            }
        }

        this.renderer.render();
        this.showNotification(`✅ 마디 ${targetMeasure}부터 ${count}개 마디 붙여넣기 완료`);
        return true;
    }

    showNotification(msg, isError = false) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            document.body.appendChild(toast);
        }
        toast.style.cssText = `
            position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
            background: ${isError ? 'rgba(255,50,50,0.95)' : 'rgba(0,230,118,0.95)'};
            color: ${isError ? '#fff' : '#000'}; padding: 14px 32px;
            border-radius: 8px; font-weight: 600; z-index: 9999;
            font-family: 'Inter', sans-serif; font-size: 14px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            transition: opacity 0.5s; opacity: 1;
        `;
        toast.textContent = msg;
        setTimeout(() => { toast.style.opacity = '0'; }, 4000);
    }
}
