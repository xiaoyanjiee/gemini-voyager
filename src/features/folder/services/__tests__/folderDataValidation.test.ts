import { describe, expect, it } from 'vitest';

import { safeParseFolderData } from '../folderDataValidation';

const validFolder = {
  id: 'folder-1',
  name: 'Work',
  parentId: null,
  isExpanded: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('folder data validation', () => {
  it('accepts a valid folder payload', () => {
    expect(
      safeParseFolderData({ folders: [validFolder], folderContents: { 'folder-1': [] } }).success,
    ).toBe(true);
  });

  it('rejects javascript URLs from imported data', () => {
    const result = safeParseFolderData({
      folders: [validFolder],
      folderContents: {
        'folder-1': [
          {
            conversationId: 'conversation-1',
            title: 'Unsafe',
            url: 'javascript:alert(1)',
            addedAt: 1,
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects orphan folder references and unknown fields', () => {
    expect(
      safeParseFolderData({
        folders: [{ ...validFolder, parentId: 'missing', html: '<img onerror=alert(1)>' }],
        folderContents: { 'folder-1': [] },
      }).success,
    ).toBe(false);
  });
});
