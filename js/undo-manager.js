/**
 * UndoManager - 스냅샷 기반 Undo/Redo 시스템
 */

class UndoManager {
    constructor(noteData, renderer) {
        this.noteData = noteData;
        this.renderer = renderer;
        
        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 50;
        
        // 초기 상태 저장
        this.saveState();
    }

    // 현재 상태를 깊은 복사(Deep Copy)하여 반환
    _snapshot() {
        const snapshot = {};
        for (let lane in this.noteData.lanes) {
            snapshot[lane] = { ...this.noteData.lanes[lane] };
        }
        return snapshot;
    }

    // 편집 수행 직전에 호출하여 현재 상태를 undoStack에 저장
    saveState() {
        // 이미 저장된 마지막 상태와 동일하다면 중복 저장 방지
        const currentSnapshot = this._snapshot();
        
        if (this.undoStack.length > 0) {
            const lastState = this.undoStack[this.undoStack.length - 1];
            if (JSON.stringify(lastState) === JSON.stringify(currentSnapshot)) {
                return;
            }
        }
        
        this.undoStack.push(currentSnapshot);
        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }
        
        // 새로운 작업이 수행되면 redoStack은 초기화
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length <= 1) return; // 초기 상태 이하는 undo 불가 (항상 1개는 유지)
        
        // 현재 상태를 redoStack에 저장
        this.redoStack.push(this._snapshot());
        
        // 직전 상태 꺼내오기 (현재 상태 버림)
        this.undoStack.pop(); 
        const previousState = this.undoStack[this.undoStack.length - 1];
        
        // noteData에 적용
        this._restore(previousState);
        this.renderer.render();
        console.log("Undo 실행 (남은 undo:", this.undoStack.length - 1, ")");
    }

    redo() {
        if (this.redoStack.length === 0) return;
        
        const nextState = this.redoStack.pop();
        
        // 현재 상태를 undoStack에 저장
        this.undoStack.push(this._snapshot());
        
        // noteData에 적용
        this._restore(nextState);
        this.renderer.render();
        console.log("Redo 실행 (남은 redo:", this.redoStack.length, ")");
    }

    _restore(snapshot) {
        for (let lane in snapshot) {
            this.noteData.lanes[lane] = { ...snapshot[lane] };
        }
    }
}
