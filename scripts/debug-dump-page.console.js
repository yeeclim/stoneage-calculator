/*
 * 현재 페이지의 HTML을 통째로 파일로 저장하는 진단용 스크립트 (브라우저 콘솔 전용)
 * scrape-zero-board23.console.js 가 0건을 수집했을 때, 실제 목록 마크업을 확인하기 위해 사용.
 *
 * 사용법: board23 목록 페이지(로그인 상태)에서 콘솔에 붙여넣고 실행 -> zero_board23_debug.html 다운로드 -> 채팅에 첨부
 */
(() => {
  console.log('a 태그 총 개수:', document.querySelectorAll('a').length);
  console.log('href에 wr_id 포함:', document.querySelectorAll('a[href*="wr_id"]').length);
  console.log('href에 idx 포함:', document.querySelectorAll('a[href*="idx"]').length);
  console.log('onclick 속성 가진 a 태그 수:', document.querySelectorAll('a[onclick]').length);
  console.log('iframe 개수:', document.querySelectorAll('iframe').length);

  const html = document.documentElement.outerHTML;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = 'zero_board23_debug.html';
  a.click();
  console.log('현재 페이지 HTML을 zero_board23_debug.html 로 저장했습니다.');
})();
