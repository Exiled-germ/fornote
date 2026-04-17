/**
 * App - 메인 애플리케이션 초기화 및 이벤트 바인딩
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. 코어 인스턴스 초기화
    const noteData = new NoteData();
    const renderer = new GridRenderer('grid-canvas', noteData);
    const editor = new Editor('grid-canvas', noteData, renderer);
    const midiParser = new MidiParser(noteData, renderer);
    const exporter = new Exporter(noteData);

    // 2. 편집 모드 버튼
    const modeBtns = document.querySelectorAll('.tool-btn');
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            editor.setMode(btn.dataset.mode);
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

    // 4. MIDI 파일 업로드
    document.getElementById('midi-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            await midiParser.parseFromBuffer(event.target.result);
            e.target.value = '';
        };
        reader.readAsArrayBuffer(file);
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

    // 7. 초기 렌더링
    renderer.updateZoomUI();
    renderer.render();

    console.log('Note Editor 초기화 완료');
});
