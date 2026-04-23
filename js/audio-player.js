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
            this.play(fromMeasure);
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
    }

    play(fromMeasure = null) {
        if (!this.audioElement) {
            // 오디오 없으면 MIDI 재생 모드 시도
            if (!this.midiNotes || this.midiNotes.length === 0) {
                this.showNotification("❌ 재생할 오디오나 MIDI가 없습니다.", true);
                return;
            }
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
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        
        this.isPlaying = true;
        const targetTime = fromMeasure !== null ? this._measureToTime(fromMeasure) : this.virtualCurrentTime || 0;
        
        this.virtualStartTime = this.audioCtx.currentTime - (targetTime / this.playbackRate);
        
        this._scheduleMidiNotes(targetTime);
        this._startLoop();
    }

    _scheduleMidiNotes(startTime) {
        // 기존 예약된 오실레이터 정지
        this._stopOscillators();
        
        this.midiNotes.forEach(note => {
            if (note.time >= startTime) {
                const playTime = this.virtualStartTime + (note.time / this.playbackRate);
                // 오류 방지를 위해 최소 0.05초의 길이 보장 (0.02초 ramp up/down 필요)
                const safeDur = Math.max(0.05, note.duration / this.playbackRate);
                
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = 440 * Math.pow(2, (note.midi - 69) / 12);
                
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                
                // ADSR (간단한 Envelope)
                gain.gain.setValueAtTime(0, playTime);
                gain.gain.linearRampToValueAtTime(0.3, playTime + 0.02);
                gain.gain.setValueAtTime(0.3, playTime + safeDur - 0.02);
                gain.gain.linearRampToValueAtTime(0, playTime + safeDur);
                
                osc.start(playTime);
                osc.stop(playTime + safeDur);
                
                this.activeOscillators.push(osc);
            }
        });
    }

    _stopOscillators() {
        if (this.activeOscillators) {
            this.activeOscillators.forEach(osc => { 
                try { osc.stop(); osc.disconnect(); } catch(e){} 
            });
            this.activeOscillators = [];
        }
    }

    pause() {
        this.isPlaying = false;
        if (this.audioElement) {
            this.audioElement.pause();
        } else {
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
            this.virtualCurrentTime = (this.audioCtx.currentTime - this.virtualStartTime) * this.playbackRate;
            this.currentTimeSec = this.virtualCurrentTime;
            
            // 마지막 노트가 끝나면 정지
            const lastNote = this.midiNotes[this.midiNotes.length - 1];
            if (lastNote && this.currentTimeSec > lastNote.time + lastNote.duration + 1) {
                this.stop();
                return;
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
