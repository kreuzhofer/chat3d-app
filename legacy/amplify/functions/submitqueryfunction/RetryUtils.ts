/**
 * Retry utility functions that don't rely on external dependencies
 */

/**
 * Options for the retry function
 */
export interface RetryOptions {
  delay: number;
  maxAttempts: number;
  handleError?: (error: any) => boolean;
}

/**
 * Retry a function with exponential backoff
 * @param fn The function to retry
 * @param options Retry options
 * @returns The result of the function
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { delay, maxAttempts, handleError } = options;
  
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // If handleError is provided and returns false, don't retry
      if (handleError && !handleError(error)) {
        throw error;
      }
      
      if (attempt === maxAttempts) {
        throw error;
      }
      
      // Wait before the next attempt with exponential backoff
      const backoffDelay = delay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  
  throw lastError;
}
