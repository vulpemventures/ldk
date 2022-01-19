import fetch from 'cross-fetch';

/**
 * throw stringified fetch() error
 * @param response returned from the fetch() call
 */
const dealWithFetchError = (response: Response) => {
  throw new Error(JSON.stringify(response));
};

/**
 * check the response type and return it
 * @param response returned from the fetch() call
 * @returns promise of data
 */
const getDataFromResponse = async (response: Response): Promise<any> => {
  const contentTypes = response.headers.get('content-type');
  const isJson = contentTypes?.includes('application/json');
  return isJson ? await response.json() : await response.text();
};

/**
 * get data from a given url using fetch()
 * @param url url for the webservice
 * @returns promise of data
 */
export const getWithFetch = async (url: string): Promise<any> => {
  const response = await fetch(url, { method: 'get', mode: 'cors' });
  if (response.status !== 200) dealWithFetchError(response);
  return await getDataFromResponse(response);
};
