export function buildGallBaseUrl(isMgallery: boolean): string {
  return isMgallery ? 'https://gall.dcinside.com/mgallery/' : 'https://gall.dcinside.com/';
}

export function encodeDcSearchKeyword(keyword: string): string {
  return encodeURIComponent(keyword).replace(/%/g, '.');
}

export function buildDcSearchUrl(params: { galleryId: string; isMgallery: boolean; keyword: string }): string {
  const base = buildGallBaseUrl(params.isMgallery);
  const encoded = encodeDcSearchKeyword(params.keyword);
  const url = new URL('board/lists', base);
  url.searchParams.set('id', params.galleryId);
  url.searchParams.set('s_type', 'search_subject_memo');
  url.searchParams.set('s_keyword', encoded);
  return url.toString();
}

