import * as diff from 'fast-diff';
import cloneDeep = require('lodash.clonedeep');
import isEqual = require('lodash.isequal');
import AttributeMap from './AttributeMap';
import Op from './Op';
import OpIterator from './OpIterator';

const NULL_CHARACTER = String.fromCharCode(0); // Placeholder char for embed in diff()

interface EmbedHandler<T> {
  compose(a: T, b: T, keepNull: boolean): T;
  invert(a: T, b: T): T;
  transform(a: T, b: T, priority: boolean): T;
}

const getEmbedTypeAndData = (
  a: Op['insert'] | Op['retain'],
  b: Op['insert'],
): [string, unknown, unknown] => {
  if (typeof a !== 'object' || a === null) {
    throw new Error(`cannot retain a ${typeof a}`);
  }
  if (typeof b !== 'object' || b === null) {
    throw new Error(`cannot retain a ${typeof b}`);
  }
  const embedType = Object.keys(a)[0];
  if (!embedType || embedType !== Object.keys(b)[0]) {
    throw new Error(
      `embed types not matched: ${embedType} != ${Object.keys(b)[0]}`,
    );
  }
  return [embedType, a[embedType], b[embedType]];
};

class Delta {
  static Op = Op;
  static OpIterator = OpIterator;
  static AttributeMap = AttributeMap;
  private static handlers: { [embedType: string]: EmbedHandler<unknown> } = {};

  static registerEmbed<T>(embedType: string, handler: EmbedHandler<T>): void {
    this.handlers[embedType] = handler;
  }

  static unregisterEmbed(embedType: string): void {
    delete this.handlers[embedType];
  }

  private static getHandler(embedType: string): EmbedHandler<unknown> {
    const handler = this.handlers[embedType];
    if (!handler) {
      throw new Error(`no handlers for embed type "${embedType}"`);
    }
    return handler;
  }

  ops: Op[];
  constructor(ops?: Op[] | { ops: Op[] }) {
    // Assume we are given a well formed ops
    if (Array.isArray(ops)) {
      this.ops = ops;
    } else if (ops != null && Array.isArray(ops.ops)) {
      this.ops = ops.ops;
    } else {
      this.ops = [];
    }
  }

  insert(
    arg: string | Record<string, unknown>,
    attributes?: AttributeMap | null,
  ): this {
    const newOp: Op = {};
    if (typeof arg === 'string' && arg.length === 0) {
      return this;
    }
    newOp.insert = arg;
    if (
      attributes != null &&
      typeof attributes === 'object' &&
      Object.keys(attributes).length > 0
    ) {
      newOp.attributes = attributes;
    }
    return this.push(newOp);
  }

  delete(length: number): this {
    if (length <= 0) {
      return this;
    }
    return this.push({ delete: length });
  }

  retain(
    length: number | Record<string, unknown>,
    attributes?: AttributeMap | null,
  ): this {
    if (typeof length === 'number' && length <= 0) {
      return this;
    }
    const newOp: Op = { retain: length };
    if (
      attributes != null &&
      typeof attributes === 'object' &&
      Object.keys(attributes).length > 0
    ) {
      newOp.attributes = attributes;
    }
    return this.push(newOp);
  }

  push(newOp: Op): this {
    // 1. 获取当前序列的长度和最后一个操作
    let index = this.ops.length;
    let lastOp = this.ops[index - 1];
    newOp = cloneDeep(newOp);

    // 2. 如果最后一个操作存在，尝试进行优化
    if (typeof lastOp === 'object') {
      // 2.1 合并相邻的操作（新操作、最后操作都是删除，合并删除；删除数量相加）
      if (
        typeof newOp.delete === 'number' &&
        typeof lastOp.delete === 'number'
      ) {
        this.ops[index - 1] = { delete: lastOp.delete + newOp.delete };
        return this;
      }
      // Since it does not matter if we insert before or after deleting at the same index,
      // always prefer to insert first
      // 在同一个索引位置进行插入和删除，操作的先后顺序不影响结果；即无论先插入还是先删除，结果都是一样的
      // 这里的处理方式是先执行插入，再执行删除
      // 所以这里的逻辑是：当遇到删除操作后跟插入操作时，会调整它们的顺序，确保插入操作先执行。

      // 2.2 如果最后一个操作是删除，新操作是插入，则将新操作插入到序列中
      if (typeof lastOp.delete === 'number' && newOp.insert != null) {
        index -= 1;
        lastOp = this.ops[index - 1];
        if (typeof lastOp !== 'object') {
          // 如果lastOp 不存在，则将新操作插入到序列头部（先delete、再insert）
          this.ops.unshift(newOp);
          return this;
        }
      }
      if (isEqual(newOp.attributes, lastOp.attributes)) {
        if (
          typeof newOp.insert === 'string' &&
          typeof lastOp.insert === 'string'
        ) {
          // 最后、新操作都是插入，合并插入
          this.ops[index - 1] = { insert: lastOp.insert + newOp.insert };
          if (typeof newOp.attributes === 'object') {
            this.ops[index - 1].attributes = newOp.attributes;
          }
          return this;
        } else if (
          typeof newOp.retain === 'number' &&
          typeof lastOp.retain === 'number'
        ) {
          this.ops[index - 1] = { retain: lastOp.retain + newOp.retain };
          if (typeof newOp.attributes === 'object') {
            this.ops[index - 1].attributes = newOp.attributes;
          }
          return this;
        }
      }
    }
    // 3. 操作无法合并，根据索引位置添加新操作
    if (index === this.ops.length) {
      this.ops.push(newOp);
    } else {
      this.ops.splice(index, 0, newOp);
    }
    return this;
  }

  chop(): this {
    const lastOp = this.ops[this.ops.length - 1];
    if (lastOp && typeof lastOp.retain === 'number' && !lastOp.attributes) {
      this.ops.pop();
    }
    return this;
  }

  filter(predicate: (op: Op, index: number) => boolean): Op[] {
    return this.ops.filter(predicate);
  }

  forEach(predicate: (op: Op, index: number) => void): void {
    this.ops.forEach(predicate);
  }

  map<T>(predicate: (op: Op, index: number) => T): T[] {
    return this.ops.map(predicate);
  }

  partition(predicate: (op: Op) => boolean): [Op[], Op[]] {
    const passed: Op[] = [];
    const failed: Op[] = [];
    this.forEach((op) => {
      const target = predicate(op) ? passed : failed;
      target.push(op);
    });
    return [passed, failed];
  }

  reduce<T>(
    predicate: (accum: T, curr: Op, index: number) => T,
    initialValue: T,
  ): T {
    return this.ops.reduce(predicate, initialValue);
  }

  changeLength(): number {
    return this.reduce((length, elem) => {
      if (elem.insert) {
        return length + Op.length(elem);
      } else if (elem.delete) {
        return length - elem.delete;
      }
      return length;
    }, 0);
  }

  length(): number {
    return this.reduce((length, elem) => {
      return length + Op.length(elem);
    }, 0);
  }

  slice(start = 0, end = Infinity): Delta {
    const ops = [];
    const iter = new OpIterator(this.ops);
    let index = 0;
    while (index < end && iter.hasNext()) {
      let nextOp;
      if (index < start) {
        nextOp = iter.next(start - index);
      } else {
        nextOp = iter.next(end - index);
        ops.push(nextOp);
      }
      index += Op.length(nextOp);
    }
    return new Delta(ops);
  }

  /**
   * 合并两个Delta对象
   * @param other 
   * @returns 
   */
  compose(other: Delta): Delta {
    const thisIter = new OpIterator(this.ops);
    const otherIter = new OpIterator(other.ops);
    const ops = [];
    const firstOther = otherIter.peek();
    if (
      firstOther != null &&
      typeof firstOther.retain === 'number' &&
      firstOther.attributes == null
    ) {
      let firstLeft = firstOther.retain;
      while (
        thisIter.peekType() === 'insert' &&
        thisIter.peekLength() <= firstLeft
      ) {
        firstLeft -= thisIter.peekLength();
        ops.push(thisIter.next());
      }
      if (firstOther.retain - firstLeft > 0) {
        otherIter.next(firstOther.retain - firstLeft);
      }
    }
    const delta = new Delta(ops);
    while (thisIter.hasNext() || otherIter.hasNext()) {
      if (otherIter.peekType() === 'insert') {
        delta.push(otherIter.next());
      } else if (thisIter.peekType() === 'delete') {
        delta.push(thisIter.next());
      } else {
        const length = Math.min(thisIter.peekLength(), otherIter.peekLength());
        const thisOp = thisIter.next(length);
        const otherOp = otherIter.next(length);
        if (otherOp.retain) {
          const newOp: Op = {};
          if (typeof thisOp.retain === 'number') {
            newOp.retain =
              typeof otherOp.retain === 'number' ? length : otherOp.retain;
          } else {
            if (typeof otherOp.retain === 'number') {
              if (thisOp.retain == null) {
                newOp.insert = thisOp.insert;
              } else {
                newOp.retain = thisOp.retain;
              }
            } else {
              const action = thisOp.retain == null ? 'insert' : 'retain';
              const [embedType, thisData, otherData] = getEmbedTypeAndData(
                thisOp[action],
                otherOp.retain,
              );
              const handler = Delta.getHandler(embedType);
              newOp[action] = {
                [embedType]: handler.compose(
                  thisData,
                  otherData,
                  action === 'retain',
                ),
              };
            }
          }
          // Preserve null when composing with a retain, otherwise remove it for inserts
          const attributes = AttributeMap.compose(
            thisOp.attributes,
            otherOp.attributes,
            typeof thisOp.retain === 'number',
          );
          if (attributes) {
            newOp.attributes = attributes;
          }
          delta.push(newOp);

          // Optimization if rest of other is just retain
          if (
            !otherIter.hasNext() &&
            isEqual(delta.ops[delta.ops.length - 1], newOp)
          ) {
            const rest = new Delta(thisIter.rest());
            return delta.concat(rest).chop();
          }

          // Other op should be delete, we could be an insert or retain
          // Insert + delete cancels out
        } else if (
          typeof otherOp.delete === 'number' &&
          (typeof thisOp.retain === 'number' ||
            (typeof thisOp.retain === 'object' && thisOp.retain !== null))
        ) {
          delta.push(otherOp);
        }
      }
    }
    return delta.chop();
  }

  concat(other: Delta): Delta {
    const delta = new Delta(this.ops.slice());
    if (other.ops.length > 0) {
      delta.push(other.ops[0]);
      delta.ops = delta.ops.concat(other.ops.slice(1));
    }
    return delta;
  }
  /**
   * 差异对比
   * @param other 
   * @param cursor 
   * @returns 
   */

  diff(other: Delta, cursor?: number | diff.CursorInfo): Delta {
    if (this.ops === other.ops) {
      return new Delta();
    }
    const strings = [this, other].map((delta) => {
      return delta
        .map((op) => {
          if (op.insert != null) {
            return typeof op.insert === 'string' ? op.insert : NULL_CHARACTER;
          }
          const prep = delta === other ? 'on' : 'with';
          throw new Error('diff() called ' + prep + ' non-document');
        })
        .join('');
    });
    const retDelta = new Delta();
    const diffResult = diff(strings[0], strings[1], cursor, true);
    const thisIter = new OpIterator(this.ops);
    const otherIter = new OpIterator(other.ops);
    diffResult.forEach((component: diff.Diff) => {
      let length = component[1].length;
      while (length > 0) {
        let opLength = 0;
        switch (component[0]) {
          case diff.INSERT:
            opLength = Math.min(otherIter.peekLength(), length);
            retDelta.push(otherIter.next(opLength));
            break;
          case diff.DELETE:
            opLength = Math.min(length, thisIter.peekLength());
            thisIter.next(opLength);
            retDelta.delete(opLength);
            break;
          case diff.EQUAL:
            opLength = Math.min(
              thisIter.peekLength(),
              otherIter.peekLength(),
              length,
            );
            const thisOp = thisIter.next(opLength);
            const otherOp = otherIter.next(opLength);
            if (isEqual(thisOp.insert, otherOp.insert)) {
              retDelta.retain(
                opLength,
                AttributeMap.diff(thisOp.attributes, otherOp.attributes),
              );
            } else {
              retDelta.push(otherOp).delete(opLength);
            }
            break;
        }
        length -= opLength;
      }
    });
    return retDelta.chop();
  }

  eachLine(
    predicate: (
      line: Delta,
      attributes: AttributeMap,
      index: number,
    ) => boolean | void,
    newline = '\n',
  ): void {
    const iter = new OpIterator(this.ops);
    let line = new Delta();
    let i = 0;
    while (iter.hasNext()) {
      if (iter.peekType() !== 'insert') {
        return;
      }
      const thisOp = iter.peek();
      const start = Op.length(thisOp) - iter.peekLength();
      const index =
        typeof thisOp.insert === 'string'
          ? thisOp.insert.indexOf(newline, start) - start
          : -1;
      if (index < 0) {
        line.push(iter.next());
      } else if (index > 0) {
        line.push(iter.next(index));
      } else {
        if (predicate(line, iter.next(1).attributes || {}, i) === false) {
          return;
        }
        i += 1;
        line = new Delta();
      }
    }
    if (line.length() > 0) {
      predicate(line, {}, i);
    }
  }

  invert(base: Delta): Delta {
    const inverted = new Delta();
    this.reduce((baseIndex, op) => {
      if (op.insert) {
        inverted.delete(Op.length(op));
      } else if (typeof op.retain === 'number' && op.attributes == null) {
        inverted.retain(op.retain);
        return baseIndex + op.retain;
      } else if (op.delete || typeof op.retain === 'number') {
        const length = (op.delete || op.retain) as number;
        const slice = base.slice(baseIndex, baseIndex + length);
        slice.forEach((baseOp) => {
          if (op.delete) {
            inverted.push(baseOp);
          } else if (op.retain && op.attributes) {
            inverted.retain(
              Op.length(baseOp),
              AttributeMap.invert(op.attributes, baseOp.attributes),
            );
          }
        });
        return baseIndex + length;
      } else if (typeof op.retain === 'object' && op.retain !== null) {
        const slice = base.slice(baseIndex, baseIndex + 1);
        const baseOp = new OpIterator(slice.ops).next();
        const [embedType, opData, baseOpData] = getEmbedTypeAndData(
          op.retain,
          baseOp.insert,
        );
        const handler = Delta.getHandler(embedType);
        inverted.retain(
          { [embedType]: handler.invert(opData, baseOpData) },
          AttributeMap.invert(op.attributes, baseOp.attributes),
        );
        return baseIndex + 1;
      }
      return baseIndex;
    }, 0);
    return inverted.chop();
  }

  transform(index: number, priority?: boolean): number;
  transform(other: Delta, priority?: boolean): Delta;
  transform(arg: number | Delta, priority = false): typeof arg {
    priority = !!priority;
    if (typeof arg === 'number') {
      return this.transformPosition(arg, priority);
    }
    const other: Delta = arg;
    const thisIter = new OpIterator(this.ops);
    const otherIter = new OpIterator(other.ops);
    const delta = new Delta();
    while (thisIter.hasNext() || otherIter.hasNext()) {
      if (
        thisIter.peekType() === 'insert' &&
        (priority || otherIter.peekType() !== 'insert')
      ) {
        delta.retain(Op.length(thisIter.next()));
      } else if (otherIter.peekType() === 'insert') {
        delta.push(otherIter.next());
      } else {
        const length = Math.min(thisIter.peekLength(), otherIter.peekLength());
        const thisOp = thisIter.next(length);
        const otherOp = otherIter.next(length);
        if (thisOp.delete) {
          // Our delete either makes their delete redundant or removes their retain
          continue;
        } else if (otherOp.delete) {
          delta.push(otherOp);
        } else {
          const thisData = thisOp.retain;
          const otherData = otherOp.retain;
          let transformedData: Op['retain'] =
            typeof otherData === 'object' && otherData !== null
              ? otherData
              : length;
          if (
            typeof thisData === 'object' &&
            thisData !== null &&
            typeof otherData === 'object' &&
            otherData !== null
          ) {
            const embedType = Object.keys(thisData)[0];
            if (embedType === Object.keys(otherData)[0]) {
              const handler = Delta.getHandler(embedType);
              if (handler) {
                transformedData = {
                  [embedType]: handler.transform(
                    thisData[embedType],
                    otherData[embedType],
                    priority,
                  ),
                };
              }
            }
          }

          // We retain either their retain or insert
          delta.retain(
            transformedData,
            AttributeMap.transform(
              thisOp.attributes,
              otherOp.attributes,
              priority,
            ),
          );
        }
      }
    }
    return delta.chop();
  }

  transformPosition(index: number, priority = false): number {
    priority = !!priority;
    const thisIter = new OpIterator(this.ops);
    let offset = 0;
    while (thisIter.hasNext() && offset <= index) {
      const length = thisIter.peekLength();
      const nextType = thisIter.peekType();
      thisIter.next();
      if (nextType === 'delete') {
        index -= Math.min(length, index - offset);
        continue;
      } else if (nextType === 'insert' && (offset < index || !priority)) {
        index += length;
      }
      offset += length;
    }
    return index;
  }
}

export default Delta;

export { Op, OpIterator, AttributeMap };

if (typeof module === 'object') {
  module.exports = Delta;
  module.exports.default = Delta;
}
