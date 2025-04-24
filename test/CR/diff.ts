import Delta from '../../src/Delta';

describe('合并算法测试', () => {
  it('插入后删除', () => {
    const delta = new Delta();
    delta.insert('A');
    /**
     * 插入和删除会做优化
     * [
     *  {insert: 'AB'},
     *  {delete: 1}
     * ]
     */
    delta.delete(1);
    delta.insert('B');

    const expected = new Delta().insert('B');
    expect(delta).toEqual(expected);
  });

  it('insert 合并', () => {
    const delta = new Delta();
    /**
     * 这两个会合并为一个操作
     *  [
     *    {insert: 'AB'},
     *  ]
     */

    delta.insert('A');
    delta.insert('B');

    const expected = new Delta().insert('AB');
    expect(delta.diff(expected)).toEqual(expected);
  });
});
