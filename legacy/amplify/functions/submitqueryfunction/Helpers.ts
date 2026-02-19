export interface DocumentSections {
    plan: string;
    code: string;
    parameters: string;
    comment: string;
  }

export function extractDocumentSections(text: string): DocumentSections {
  
  const extractSection = (section: string): string => {
    const regex = new RegExp(`<${section}>\\n([\\s\\S]*?)\\n<\/${section}>|<${section}>([\\s\\S]*?)<\/${section}>`);
    const match = text.match(regex);
    return (match?.[1] || match?.[2] || '').trim();
  };

  function isJsonString(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  if (isJsonString(text)) {
    const json = JSON.parse(text);
    return {
      plan: json.plan || '',
      code: json.code || '',
      parameters: json.parameters || '',
      comment: json.comment || ''
    };
  }
  return {
    plan: extractSection('plan'),
    code: extractSection('code'),
    parameters: extractSection('parameters'),
    comment: extractSection('comment')
  };
}