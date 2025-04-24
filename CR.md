# Delta对象
```js
class Delta{

    ops: Op[]
}
```

# ops类型
```ts
type Op = {
    insert?: string | Record<string, unknown>
    delete?: number
    retain?: number
}

ops = [
    {insert: 'A'},
    // 这里的length是删除长度（从当前位置开始删除）
    {delete: 1},
    // 这里的length是保留长度（从当前位置开始保留）
    {retain: 2},
]
```

# 数据设计
## 扁平数据
Delta 中数据都是扁平的，不存在子节点一说；
假定富文本不存在块元素的嵌套，即一行中不能同时存在标题和列表

## 数据紧凑
不紧凑表达
```ts
var ops = [
  { insert: 'Hel' },
  { insert: 'lo ' },
  { insert: 'World', attributes: { bold: true } }
];
```
紧凑表达
```ts
var ops = [
  { insert: 'Hello '},
  { insert: 'World', attributes: { bold: true } }
];
```

## push算法
- 连续的 insert/retain/delete 需要判断做合并操作，对于 insert/retain 则是 attrs 相同且 insert 都为 string 即可合并，例如 new Delta().insert('A').insert('B')，需要合并成 insert: 'AB'；
- delete 之后的 insert/retain，需要做顺序调整，delete 永远在最后；
- 其他场景则直接 push ops 即可。

## slice算法



## 参考链接
[Delta 文档结构](https://tech.kujiale.com/fu-wen-ben-bian-ji-qi-quill-js-xi-lie-yi-delta-wen-dang-jie-gou/)