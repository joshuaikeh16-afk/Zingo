export const genreChoices = [['action','Action'],['adventure','Adventure'],['comedy','Comedy'],['drama','Drama'],['fantasy','Fantasy'],['romance','Romance'],['thriller','Thriller'],['mystery','Mystery'],['scifi','Sci-fi'],['documentary','Documentaries'],['animation','Animation']];
export const countries = [['NG','Nigeria'],['GH','Ghana'],['ZA','South Africa'],['KE','Kenya'],['GB','United Kingdom'],['US','United States'],['CA','Canada'],['IN','India']];
export function preferencesFor(profile = {}) {
  const saved = profile.recommendation_preferences || {};
  const interests = profile.interests || [];
  return {
    content_types: saved.content_types?.length ? saved.content_types : interests.includes('anime') ? ['movie','anime'] : ['movie','tv'],
    genres: saved.genres || interests.filter((value) => genreChoices.some(([key]) => key === value)),
    country: saved.country || 'NG', language: saved.language || 'any', providers: saved.providers || [], favorites: saved.favorites || [],
    football: interests.includes('football'),
  };
}
