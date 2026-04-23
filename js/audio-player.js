/**
 * AudioPlayer - WAV/MP3 오디오 파일 재생 전용
 * MIDI/TXT는 노트 표시용으로만 사용, 재생은 오디오 파일 기반
 * BPM 기준으로 시간 → 마디 위치를 정확히 계산하여 플레이라인 표시
 */

class AudioPlayer {
    constructor(noteData, renderer) {
        this.noteData = noteData;
        this.renderer = renderer;
        
        this.isPlaying = false;
        this.audioElement = null;
        
        this.currentTimeSec = 0;
        this.animationFrameId = null;
        this.offsetMs = 0;
        this.playbackRate = 1.0; // 배속
        
        // MIDI 재생 지원 (WAV 없을 때)
        this.midiNotes = [];
        this.audioCtx = null;
        this.activeOscillators = [];
        this.virtualStartTime = 0;
        this.virtualCurrentTime = 0;
    }

    setMidiNotes(notes) {
        this.midiNotes = notes;
    }

    // ─── 오디오 파일 로드 ───
    async loadAudioFile(file) {
        if (!file.type.startsWith('audio/')) {
            this.showNotification("❌ 오디오 파일(WAV/MP3)만 로드 가능합니다.", true);
            return;
        }

        const url = URL.createObjectURL(file);
        
        if (this.audioElement) {
            this.stop();
            this.audioElement.src = url;
        } else {
            this.audioElement = new Audio(url);
            this.audioElement.addEventListener('ended', () => this.stop());
        }

        this.showNotification(`🎵 오디오 로드 완료: ${file.name}`);
        this.renderer.render();
        
        // --- 무음 여백(Silence) 자동 감지 로직 ---
        try {
            const arrayBuffer = await file.arrayBuffer();
            // 브라우저 AudioContext를 통해 디코딩
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            const channelData = audioBuffer.getChannelData(0);
            const threshold = 0.02; // 진폭 0.02 초과 시 소리 시작으로 간주
            let firstSoundIndex = 0;
            
            for (let i = 0; i < channelData.length; i++) {
                if (Math.abs(channelData[i]) > threshold) {
                    firstSoundIndex = i;
                    break;
                }
            }
            
            // 샘플 인덱스를 초(sec)로 변환 후 ms로 계산
            const silenceMs = Math.floor((firstSoundIndex / audioBuffer.sampleRate) * 1000);
            
            if (silenceMs > 0) {
                this.setOffset(silenceMs);
                const offsetInput = document.getElementById('audio-offset');
                if (offsetInput) offsetInput.value = silenceMs;
                this.showNotification(`✅ 자동 싱크: ${silenceMs}ms의 시작 무음이 감지되어 오프셋이 자동 설정되었습니다.`);
            }
        } catch (e) {
            console.warn("오디오 자동 싱크 감지 실패:", e);
        }
    }

    // ─── BPM 기반 시간↔마디 변환 유틸 ───
    _getSecondsPerMeasure() {
        const bpm = this.noteData.bpm;
        const num = this.noteData.timeSignature.numerator;
        const den = this.noteData.timeSignature.denominator;
        const secondsPerBeat = 60 / bpm;
        const beatsPerMeasure = num * (4 / den);
        return secondsPerBeat * beatsPerMeasure;
    }

    _getTimeSlotSec() {
        const secondsPerBeat = 60 / this.noteData.bpm;
        return secondsPerBeat / this.noteData.slotsPerBeat;
    }

    _measureToTime(measure) {
        return (measure - 1) * this._getSecondsPerMeasure();
    }

    _timeToAbsSlot(timeSec) {
        return timeSec / this._getTimeSlotSec();
    }

    _timeToMeasure(timeSec) {
        return Math.floor(timeSec / this._getSecondsPerMeasure()) + 1;
    }

    // ─── 재생 컨트롤 ───
    async togglePlay(fromMeasure = null) {
        if (this.isPlaying) {
            this.pause();
        } else {
            // fromMeasure가 명시적으로 지정되지 않았고, 일시정지 상태가 아니면 처음부터
            if (fromMeasure === null && (!this.virtualCurrentTime || this.virtualCurrentTime === 0)) {
                // 처음부터 재생
                this.play(null);
            } else {
                // 일시정지 위치에서 재개 또는 특정 마디부터
                this.play(fromMeasure);
            }
        }
    }

    // 오프셋 설정 (ms)
    setOffset(ms) {
        this.offsetMs = ms;
    }

    // 배속 설정
    setSpeed(rate) {
        this.playbackRate = rate;
        if (this.audioElement) {
            this.audioElement.playbackRate = rate;
        }
        // MIDI 재생 중이면 재스케줄링 필요
        if (this.isPlaying && this.audioCtx && !this.audioElement) {
            console.log(`[MIDI] 배속 변경: ${rate}x - 재스케줄링 필요`);
            // 기존 스케줄링 초기화
            this._stopOscillators();
            this.midiLastScheduledTime = this.virtualCurrentTime || this.midiPlaybackOffset;
        }
    }

    play(fromMeasure = null) {
        if (!this.audioElement) {
            // 오디오 없으면 MIDI 재생 모드 시도
            console.log('[AudioPlayer] 오디오 파일 없음, MIDI 재생 시도');
            console.log('[AudioPlayer] midiNotes 개수:', this.midiNotes ? this.midiNotes.length : 0);
            
            if (!this.midiNotes || this.midiNotes.length === 0) {
                this.showNotification("❌ 재생할 오디오나 MIDI가 없습니다. 오디오 파일(WAV/MP3)을 로드하세요.", true);
                return;
            }
            
            console.log('[AudioPlayer] MIDI 재생 시작');
            this._startMidiPlayback(fromMeasure);
            return;
        }

        this.isPlaying = true;
        
        // 특정 마디부터 재생
        if (fromMeasure !== null) {
            const targetTime = this._measureToTime(fromMeasure);
            // 오프셋 적용: 노트 시간 → 오디오 시간 변환
            // offsetMs > 0 → 오디오가 노트보다 늦으니까 오디오를 더 일찍 틀어야
            const audioTime = Math.max(0, targetTime + this.offsetMs / 1000);
            this.audioElement.currentTime = audioTime;
        }
        
        // 배속 적용
        this.audioElement.playbackRate = this.playbackRate;
        
        this.audioElement.play().catch(e => {
            console.error("Audio play error:", e);
            this.showNotification("❌ 오디오 재생 실패", true);
            this.isPlaying = false;
        });

        // 플레이라인 업데이트 루프 시작
        this._startLoop();
    }

    _startMidiPlayback(fromMeasure) {
        // AudioContext 초기화
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        
        this.isPlaying = true;
        
        // 시작 시간 계산 (초 단위)
        let startTimeInSec;
        if (fromMeasure !== null) {
            // 특정 마디부터 재생
            startTimeInSec = this._measureToTime(fromMeasure);
        } else if (this.virtualCurrentTime !== undefined && this.virtualCurrentTime > 0) {
            // 일시정지 후 재개: 저장된 위치부터
            startTimeInSec = this.virtualCurrentTime;
            console.log(`[MIDI] 일시정지 위치에서 재개: ${startTimeInSec.toFixed(3)}초`);
        } else {
            // 처음부터 재생
            startTimeInSec = 0;
        }
        
        console.log(`[MIDI] 재생 시작 - 마디: ${fromMeasure || '현재'}, 시간: ${startTimeInSec.toFixed(3)}초`);
        
        // 현재 AudioContext 시간 저장
        this.midiPlaybackStartTime = this.audioCtx.currentTime;
        this.midiPlaybackOffset = startTimeInSec;
        this.midiScheduleAheadTime = 5.0; // 5초 앞까지만 스케줄링
        this.midiLastScheduledTime = startTimeInSec;
        
        // 초기 스케줄링
        this._scheduleMidiNotesChunk();
        
        // 플레이라인 업데이트 루프 시작
        this._startLoop();
        
        this.showNotification(`🎹 MIDI 재생 (${this.midiNotes.length}개 노트)`);
    }

    _scheduleMidiNotesChunk() {
        const now = this.audioCtx.currentTime;
        const currentPlayTime = this.midiPlaybackOffset + (now - this.midiPlaybackStartTime) * this.playbackRate;
        const scheduleUntil = currentPlayTime + this.midiScheduleAheadTime;
        
        let scheduled = 0;
        
        this.midiNotes.forEach((note, idx) => {
            // 이미 스케줄링한 노트는 스킵
            if (note.time < this.midiLastScheduledTime) return;
            
            // 스케줄링 범위를 벗어나면 중단
            if (note.time > scheduleUntil) return;
            
            // 실제 재생 시간 = 현재 시간 + (노트 시간 - 현재 재생 시간) / 배속
            const playAt = now + (note.time - currentPlayTime) / this.playbackRate;
            
            // 과거 시간이면 스킵
            if (playAt < now) return;
            
            // 노트 길이도 배속 적용
            const duration = Math.max(0.05, note.duration / this.playbackRate);
            
            // 오실레이터 생성
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            
            // 주파수 계산 (MIDI 번호 → Hz)
            const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
            osc.frequency.value = freq;
            osc.type = 'sine';
            
            // 연결
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            
            // 볼륨 엔벨로프 (ADSR)
            const attackTime = 0.01;
            const releaseTime = 0.01;
            const sustainLevel = 0.3;
            
            gainNode.gain.setValueAtTime(0, playAt);
            gainNode.gain.linearRampToValueAtTime(sustainLevel, playAt + attackTime);
            gainNode.gain.setValueAtTime(sustainLevel, playAt + duration - releaseTime);
            gainNode.gain.linearRampToValueAtTime(0, playAt + duration);
            
            // 재생 시작/종료
            osc.start(playAt);
            osc.stop(playAt + duration);
            
            this.activeOscillators.push(osc);
            scheduled++;
            
            // 처음 3개만 로그
            if (scheduled <= 3) {
                console.log(`  [${idx}] midi=${note.midi}, time=${note.time.toFixed(3)}s → play at ${playAt.toFixed(3)}s (+${(playAt - now).toFixed(3)}s), rate=${this.playbackRate}x`);
            }
        });
        
        this.midiLastScheduledTime = scheduleUntil;
        
        if (scheduled > 0) {
            console.log(`[MIDI] 청크 스케줄링: ${scheduled}개 (${currentPlayTime.toFixed(1)}s ~ ${scheduleUntil.toFixed(1)}s) at ${this.playbackRate}x`);
        }
    }

    _stopOscillators() {
        if (this.activeOscillators && this.activeOscillators.length > 0) {
            console.log(`[MIDI] 오실레이터 정리: ${this.activeOscillators.length}개`);
            this.activeOscillators.forEach(osc => { 
                try { 
                    osc.stop(); 
                    osc.disconnect(); 
                } catch(e){} 
            });
            this.activeOscillators = [];
        }
    }

    pause() {
        this.isPlaying = false;
        if (this.audioElement) {
            this.audioElement.pause();
        } else if (this.audioCtx) {
            // MIDI 재생 중 일시정지: 현재 재생 위치 저장
            const elapsed = this.audioCtx.currentTime - this.midiPlaybackStartTime;
            this.virtualCurrentTime = this.midiPlaybackOffset + elapsed * this.playbackRate;
            console.log(`[MIDI] 일시정지 - 현재 위치: ${this.virtualCurrentTime.toFixed(3)}초`);
            this._stopOscillators();
        }
        this._stopLoop();
    }

    stop() {
        this.isPlaying = false;
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        } else {
            this.virtualCurrentTime = 0;
            this.midiPlaybackStartTime = 0;
            this.midiPlaybackOffset = 0;
            this._stopOscillators();
        }
        this._stopLoop();
        this.renderer.currentPlaybackSlot = null;
        this.renderer.render();
    }

    // ─── 플레이라인 애니메이션 루프 ───
    _startLoop() {
        this._stopLoop();
        this._loop();
    }

    _stopLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    _loop() {
        if (!this.isPlaying) return;

        if (this.audioElement) {
            // 오디오의 currentTime에서 오프셋을 빼서 노트 기준 시간으로 변환
            this.currentTimeSec = this.audioElement.currentTime - (this.offsetMs / 1000);
            if (this.audioElement.ended) {
                this.stop();
                return;
            }
        } else if (this.audioCtx) {
            // MIDI 가상 오디오 재생 모드
            const elapsed = this.audioCtx.currentTime - this.midiPlaybackStartTime;
            this.virtualCurrentTime = this.midiPlaybackOffset + elapsed * this.playbackRate;
            this.currentTimeSec = this.virtualCurrentTime;
            
            // 추가 스케줄링 (재생 중 계속 노트 추가)
            this._scheduleMidiNotesChunk();
            
            // 마지막 노트가 끝나면 정지
            if (this.midiNotes && this.midiNotes.length > 0) {
                const lastNote = this.midiNotes[this.midiNotes.length - 1];
                if (this.currentTimeSec > lastNote.time + lastNote.duration + 1) {
                    this.stop();
                    return;
                }
            }
        }

        if (this.currentTimeSec < 0) this.currentTimeSec = 0;

        // 현재 절대 슬롯 위치 계산 (BPM 기반)
        const currentAbsSlot = this._timeToAbsSlot(this.currentTimeSec);
        
        // 플레이라인 위치 업데이트
        this.renderer.setCurrentPlaybackSlot(currentAbsSlot);

        this.animationFrameId = requestAnimationFrame(() => this._loop());
    }

    // ─── 알림 ───
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
