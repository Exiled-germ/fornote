/**
 * App - 메인 애플리케이션 초기화 및 이벤트 바인딩
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. 코어 인스턴스 초기화
    const noteData = new NoteData();
    const renderer = new GridRenderer('grid-canvas', noteData);
    
    // 신규 매니저 초기화
    const undoManager = new UndoManager(noteData, renderer);
    const audioPlayer = new AudioPlayer(noteData, renderer);
    const clipboardManager = new ClipboardManager(noteData, renderer, undoManager);
    
    // 에디터 초기화
    const editor = new Editor('grid-canvas', noteData, renderer, undoManager, clipboardManager, audioPlayer);
    const midiParser = new MidiParser(noteData, renderer);
    const exporter = new Exporter(noteData);

    // 2. 모드 변경 버튼 (메인 모드)
    const mainModeBtns = document.querySelectorAll('.main-mode-btn');
    mainModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            mainModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            editor.setMainMode(btn.dataset.mode);
        });
    });



    // 3. Lane 선택 버튼
    const laneBtns = document.querySelectorAll('.lane-btn');
    laneBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            laneBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            editor.setLane(parseInt(btn.dataset.lane));
        });
    });

    // 4. 오디오 파일 업로드
    document.getElementById('audio-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        audioPlayer.loadAudioFile(file);
        e.target.value = ''; // 같은 파일 다시 로드 가능하게
    });

    // 4-1. MIDI 파일 업로드
    document.getElementById('midi-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            undoManager.saveState(); // 로드 전 상태 저장
            const playbackNotes = await midiParser.parseFromBuffer(event.target.result);
            if (playbackNotes && audioPlayer.setMidiNotes) {
                audioPlayer.setMidiNotes(playbackNotes);
            }
            e.target.value = '';
            undoManager.saveState(); // 로드 후 상태 저장
            renderer.render();
        };
        reader.readAsArrayBuffer(file);
    });

    // 4-2. TXT 파일 업로드 (기존 작업 로드)
    document.getElementById('txt-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            undoManager.saveState(); // 로드 전 상태 저장
            const success = noteData.importFromTXT(event.target.result);
            if (success) {
                // UI 메타데이터 업데이트 (간이)
                document.getElementById('info-bpm').textContent = `BPM: ${noteData.bpm}`;
                document.getElementById('info-ts').textContent = `박자: ${noteData.timeSignature.numerator}/${noteData.timeSignature.denominator}`;
                document.getElementById('info-measures').textContent = `마디: ${noteData.totalMeasures}`;
                
                audioPlayer.showNotification("✅ TXT 파일 로드 성공");
                undoManager.saveState();
                renderer.zoomFit();
            } else {
                audioPlayer.showNotification("❌ TXT 파일 로드 실패", true);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    // 5. TXT 내보내기
    document.getElementById('export-txt-btn').addEventListener('click', () => {
        exporter.downloadTXT();
    });

    // 6. 줌 컨트롤
    document.getElementById('zoom-in-btn').addEventListener('click', () => {
        renderer.setZoom(4);
    });

    document.getElementById('zoom-out-btn').addEventListener('click', () => {
        renderer.setZoom(-4);
    });

    document.getElementById('zoom-fit-btn').addEventListener('click', () => {
        renderer.zoomFit();
    });

    // 7. 재생 컨트롤
    document.getElementById('play-btn').addEventListener('click', () => {
        audioPlayer.togglePlay();
    });

    document.getElementById('pause-btn').addEventListener('click', () => {
        audioPlayer.pause();
    });

    document.getElementById('stop-btn').addEventListener('click', () => {
        audioPlayer.stop();
    });

    // 7-1. 오디오 오프셋 및 배속
    document.getElementById('audio-offset').addEventListener('change', (e) => {
        const val = parseInt(e.target.value) || 0;
        audioPlayer.setOffset(val);
    });

    document.getElementById('speed-select').addEventListener('change', (e) => {
        const rate = parseFloat(e.target.value) || 1.0;
        audioPlayer.setSpeed(rate);
    });

    // 8. 복사 / 붙여넣기 컨트롤
    document.getElementById('copy-btn').addEventListener('click', () => {
        const start = parseInt(document.getElementById('copy-start').value);
        const end = parseInt(document.getElementById('copy-end').value);
        if (!isNaN(start) && !isNaN(end)) {
            clipboardManager.copyMeasureRange(start, end);
        } else {
            clipboardManager.showNotification("❌ 시작/끝 마디 번호를 입력하세요.", true);
        }
    });

    document.getElementById('paste-btn').addEventListener('click', () => {
        const target = parseInt(document.getElementById('paste-target').value);
        if (!isNaN(target)) {
            clipboardManager.pasteMeasure(target);
        } else {
            clipboardManager.showNotification("❌ 대상 마디 번호를 입력하세요.", true);
        }
    });

    // 9. 커스텀 스크롤바 드래그
    const scrollTrack = document.getElementById('scrollbar-track');
    const scrollThumb = document.getElementById('scrollbar-thumb');
    let isDraggingScroll = false;
    let startY = 0;
    let startScrollY = 0;

    // 실제 스크롤 가능한 최대 Y
    const getMaxScroll = () => Math.max(0, renderer.getTotalHeight() - renderer.height);

    scrollThumb.addEventListener('mousedown', (e) => {
        isDraggingScroll = true;
        startY = e.clientY;
        startScrollY = renderer.scrollY;
        document.body.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
    });

    scrollTrack.addEventListener('mousedown', (e) => {
        if (e.target === scrollThumb) return; // 썸 클릭은 무시
        const trackRect = scrollTrack.getBoundingClientRect();
        const clickY = e.clientY - trackRect.top;
        const trackH = scrollTrack.clientHeight;
        const thumbH = scrollThumb.clientHeight;
        
        // 클릭한 위치의 정중앙으로 썸 이동
        let targetTop = clickY - (thumbH / 2);
        const maxTop = trackH - thumbH;
        if (targetTop < 0) targetTop = 0;
        if (targetTop > maxTop) targetTop = maxTop;
        
        const scrollRatio = targetTop / maxTop;
        renderer.scrollY = scrollRatio * getMaxScroll();
        renderer.updateScrollbar();
        renderer.render();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingScroll) return;
        const deltaY = e.clientY - startY;
        const trackH = scrollTrack.clientHeight;
        const thumbH = scrollThumb.clientHeight;
        
        const maxScrollPx = trackH - thumbH;
        if (maxScrollPx <= 0) return;
        
        const moveRatio = deltaY / maxScrollPx;
        const maxScroll = getMaxScroll();
        
        let newScrollY = startScrollY + (moveRatio * maxScroll);
        
        if (newScrollY < 0) newScrollY = 0;
        if (newScrollY > maxScroll) newScrollY = maxScroll;
        
        renderer.scrollY = newScrollY;
        renderer.updateScrollbar();
        renderer.render();
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingScroll) {
            isDraggingScroll = false;
            document.body.style.cursor = 'default';
        }
    });

    // 10. 초기 렌더링
    renderer.updateZoomUI();
    renderer.render();

    // 11. 버튼 클릭 후 포커스 해제 (스페이스바/엔터 키보드 눌림 방지)
    document.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('focus', () => {
            btn.blur();
        });
    });

    console.log('Note Editor 초기화 완료');
});
