/**
 * what to do if fetch() generated an error
 * @param response returned from the fetch() call
 */
const dealWithFetchError = (response: Response) => {
  console.error(response);
  throw new Error(JSON.stringify(response));
};

/**
 * get data from a given url using fetch()
 * @param url url for the webservice
 */
export const getWithFetch = async (url: string) => {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
  });
  if (response.status !== 200) dealWithFetchError(response);
  const data = await response.json();
  return data;
};
