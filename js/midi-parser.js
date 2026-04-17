/**
 * MidiParser - @tonejs/midi 래퍼, MIDI 로드 및 노트 자동 인식
 * BPM, 박자, 곡 길이(마디 수)를 MIDI 파일에서 자동으로 읽어옵니다.
 */

class MidiParser {
    constructor(noteData, renderer) {
        this.noteData = noteData;
        this.renderer = renderer;
        this._checkLibrary();
    }

    _checkLibrary() {
        if (typeof Midi !== 'undefined') {
            this.MidiClass = Midi;
        } else if (typeof window !== 'undefined' && window.Midi) {
            this.MidiClass = window.Midi;
        } else {
            console.error('[MidiParser] @tonejs/midi 라이브러리가 로드되지 않았습니다!');
            this.MidiClass = null;
        }
    }

    async parseFromBuffer(arrayBuffer) {
        if (!this.MidiClass) { this._checkLibrary(); }
        if (!this.MidiClass) {
            this.showNotification('❌ MIDI 라이브러리가 로드되지 않았습니다.', true);
            return;
        }

        try {
            const midi = new this.MidiClass(arrayBuffer);
            console.log('[MidiParser] MIDI 파싱 성공, 트랙:', midi.tracks.length);

            // ========== 1. MIDI에서 메타데이터 자동 추출 ==========

            // BPM 추출
            let bpm = 120;
            if (midi.header && midi.header.tempos && midi.header.tempos.length > 0) {
                bpm = Math.round(midi.header.tempos[0].bpm);
            }

            // 박자 추출
            let tsNum = 4, tsDen = 4;
            if (midi.header && midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
                const ts = midi.header.timeSignatures[0].timeSignature;
                tsNum = ts[0]; // 분자
                tsDen = ts[1]; // 분모
            }

            // 곡 길이(초) → 총 마디 수 계산
            const durationSec = midi.duration; // 전체 길이 (초)
            const secondsPerBeat = 60 / bpm;
            const beatsPerMeasure = tsNum * (4 / tsDen); // 4분음표 기준 박자 수
            const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;
            let totalMeasures = Math.ceil(durationSec / secondsPerMeasure) + 1; // 여유 1마디 추가
            if (totalMeasures < 1) totalMeasures = 1;

            const slotsPerBeat = 4; // 16분음표 해상도 고정

            console.log(`[MidiParser] 자동 인식: BPM=${bpm}, 박자=${tsNum}/${tsDen}, 곡 길이=${durationSec.toFixed(1)}초, 총 마디=${totalMeasures}`);

            // ========== 2. noteData & UI 업데이트 ==========
            this.noteData.updateMetadata(bpm, tsNum, tsDen, slotsPerBeat, totalMeasures);

            // UI 정보 표시 동기화
            document.getElementById('info-bpm').textContent = `BPM: ${bpm}`;
            document.getElementById('info-ts').textContent = `박자: ${tsNum}/${tsDen}`;
            document.getElementById('info-measures').textContent = `마디: ${totalMeasures}`;

            // 기존 일반노트 초기화
            this.noteData.lanes['normal_1'] = {};
            this.noteData.lanes['normal_2'] = {};
            this.noteData.lanes['normal_3'] = {};

            // ========== 3. 노트 배치 ==========
            const slotsPerMeasure = this.noteData.slotsPerMeasure;
            let noteCount = 0;
            let skippedCount = 0;

            midi.tracks.forEach((track, ti) => {
                if (track.notes.length === 0) return;
                console.log(`[MidiParser] 트랙 ${ti} (${track.name || '이름없음'}): ${track.notes.length} 노트`);

                track.notes.forEach((note, ni) => {
                    // note.time은 초 단위 (MIDI 파일 자체 템포로 이미 변환됨)
                    const beatsElapsed = note.time / secondsPerBeat;
                    const absSlot = Math.round(beatsElapsed * slotsPerBeat);

                    const { measureIndex, slotIndex } = this.noteData.getMeasureAndSlotFromAbsolute(absSlot);

                    if (measureIndex > this.noteData.totalMeasures) {
                        skippedCount++;
                        return;
                    }

                    if (ni < 5 && ti === 0) {
                        console.log(`  note[${ni}]: time=${note.time.toFixed(3)}s, beat=${beatsElapsed.toFixed(2)}, slot=${absSlot} → measure #${measureIndex}, pos ${slotIndex}`);
                    }

                    this.noteData.setSlot('normal_1', measureIndex, slotIndex, '1');
                    noteCount++;
                });
            });

            console.log(`[MidiParser] 완료: ${noteCount}개 배치, ${skippedCount}개 범위 초과 스킵`);

            // ========== 4. 첫 노트 마디 찾기 & 자동 스크롤 ==========
            let firstMeasureWithNote = -1;
            for (let m = 1; m <= this.noteData.totalMeasures; m++) {
                let d = this.noteData.lanes['normal_1'][m];
                if (d && d.includes('1')) {
                    if (firstMeasureWithNote === -1) firstMeasureWithNote = m;
                }
            }

            if (noteCount === 0) {
                this.showNotification('⚠️ MIDI 파일에서 노트를 찾을 수 없습니다.', true);
                this.renderer.render();
            } else {
                this.showNotification(`✅ BPM=${bpm}, ${tsNum}/${tsDen}박, ${totalMeasures}마디, ${noteCount}개 노트 로드`);
                if (firstMeasureWithNote > 0) {
                    this.renderer.scrollToMeasure(firstMeasureWithNote);
                } else {
                    this.renderer.render();
                }
            }

        } catch (error) {
            console.error('[MidiParser] 파싱 실패:', error);
            this.showNotification('❌ MIDI 파싱 실패: ' + error.message, true);
        }
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
