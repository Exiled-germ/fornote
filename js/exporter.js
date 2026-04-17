/**
 * Exporter - 데이터를 TXT 파일로 생성 및 다운로드 다운로드 처리
 */

class Exporter {
    constructor(noteData) {
        this.noteData = noteData;
    }

    downloadTXT() {
        const text = this.noteData.exportToTXT();
        
        // Blob 생성
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        
        // 다운로드 링크 생성 및 클릭
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `beatmap_${timestamp}.txt`;
        document.body.appendChild(a);
        a.click();
        
        // 클린업
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }
}
