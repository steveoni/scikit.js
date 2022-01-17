import { ImpurityMeasure } from './criterion'
import { Splitter } from './splitter'
import { int } from '../randUtils'
import { r2Score, accuracyScore } from '../metrics/metrics'
import { Split, makeDefaultSplit } from './splitter'
import { assert } from '../typesUtils'
interface NodeRecord {
  start: int
  end: int
  nSamples: int
  depth: int
  parentId: int
  isLeft: boolean
  impurity: number
}

interface Node {
  parentId: int
  leftChildId: int
  rightChildId: int
  isLeft: boolean
  isLeaf: boolean
  impurity: number
  splitFeature: int
  threshold: number
  nSamples: int
  value: int[]
}

function SetMaxFeatures(
  maxFeatures: int,
  maxFeaturesMethod: string,
  X: number[][]
) {
  let nFeatures = X[0].length
  if (maxFeatures < 1) {
    switch (maxFeaturesMethod) {
      case 'log2':
        maxFeatures = Math.floor(Math.log2(nFeatures))
        break
      case 'sqrt':
        maxFeatures = Math.floor(Math.sqrt(nFeatures))
        break
      case 'all':
        maxFeatures = nFeatures
        break
    }
  } else if (maxFeatures > nFeatures) {
    maxFeatures = nFeatures
  }
  return maxFeatures
}

function argMax(array: number[]) {
  return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1]
}

class DecisionTree {
  nodes: Node[] = []
  isBuilt = false

  getLeafNodes(X: number[][]): int[] {
    let leafNodeIds: int[] = []
    for (let i = 0; i < X.length; i++) {
      let nodeId = 0
      while (!this.nodes[nodeId].isLeaf) {
        if (
          X[i][this.nodes[nodeId].splitFeature] <= this.nodes[nodeId].threshold
        ) {
          nodeId = this.nodes[nodeId].leftChildId
        } else {
          nodeId = this.nodes[nodeId].rightChildId
        }
      }
      leafNodeIds.push(nodeId)
    }
    return leafNodeIds
  }
  populateChildIds(): void {
    for (let i = 1; i < this.nodes.length; i++) {
      if (this.nodes[i].isLeft) {
        this.nodes[this.nodes[i].parentId].leftChildId = i
      } else {
        this.nodes[this.nodes[i].parentId].rightChildId = i
      }
    }
  }
  predictProba(samples: number[][]): number[][] {
    if (!this.isBuilt) {
      throw new Error(
        'Decision tree must be built with BuildTree method before predictions can be made.'
      )
    }
    let leafNodeIds = this.getLeafNodes(samples)
    let classProbabilities = []

    for (let i = 0; i < leafNodeIds.length; i++) {
      let currentClassProbabilities = []
      let curNodeId = leafNodeIds[i]
      for (let nClass = 0; nClass < this.nodes[0].value.length; nClass++) {
        currentClassProbabilities.push(
          this.nodes[curNodeId].value[nClass] / this.nodes[curNodeId].nSamples
        )
      }
      classProbabilities.push(currentClassProbabilities)
    }
    return classProbabilities
  }
  predictClassification(samples: number[][]): int[] {
    if (!this.isBuilt) {
      throw new Error(
        'Decision tree must be built with BuildTree method before predictions can be made.'
      )
    }
    let leafNodeIds = this.getLeafNodes(samples)
    let classPredictions = []

    for (let nSample = 0; nSample < leafNodeIds.length; nSample++) {
      let curNodeId = leafNodeIds[nSample]
      classPredictions.push(argMax(this.nodes[curNodeId].value))
    }
    return classPredictions
  }
  predictRegression(samples: number[][]): int[] {
    if (!this.isBuilt) {
      throw new Error(
        'Decision tree must be built with BuildTree method before predictions can be made.'
      )
    }
    let leafNodeIds = this.getLeafNodes(samples)
    let classPredictions = []

    for (let nSample = 0; nSample < leafNodeIds.length; nSample++) {
      let curNodeId = leafNodeIds[nSample]
      classPredictions.push(this.nodes[curNodeId].value[0])
    }
    return classPredictions
  }
}

function validateX(X: number[][]) {
  if (X.length === 0) {
    throw new Error(
      `X can not be empty, but it has a length of 0. It is ${X}.`
    )
  }
  for (let i = 0; i < X.length; i++) {
    let curRow = X[i]
    if (curRow.length === 0) {
      throw new Error(
        `Rows in X can not be empty, but row ${i} in X is ${curRow}.`
      )
    }
    for (let j = 0; j < curRow.length; j++) {
      if (typeof curRow[j] !== 'number' || !Number.isFinite(curRow[j])) {
        throw new Error(
          `X must contain finite non-NaN numbers, but the element at X[${i}][${j}] is ${curRow[j]}`
        )
      }
    }
  }
}

function validateY(y: int[]) {
  if (y.length === 0) {
    throw new Error(
      `y can not be empty, but it has a length of 0. It is ${y}.`
    )
  }
  for (let i = 0; i < y.length; i++) {
    let curVal = y[i]
    if (!Number.isSafeInteger(curVal)) {
      throw new Error(
        `Some y values are not an integer. Found ${curVal} but must be an integer only`
      )
    }
    if (curVal < 0) {
      throw new Error(
        `y values must be in the range [0, N]. This implementation expects that the labels are already normalized. We found label value ${curVal}`
      )
    }
  }
}

class DecisionTreeBase {
  splitter!: Splitter
  stack: NodeRecord[] = []
  minSamplesLeaf: int
  maxDepth: int
  minSamplesSplit: int
  minImpuritySplit: number
  tree: DecisionTree
  criterion: ImpurityMeasure
  maxFeatures: int
  maxFeaturesMethod: 'log2' | 'sqrt' | 'all'
  X: number[][] = []
  y: number[] = []

  constructor({
    criterion = 'gini',
    maxDepth = Number.POSITIVE_INFINITY,
    minSamplesSplit = 2,
    minSamplesLeaf = 1,
    maxFeatures = -1,
    maxFeaturesMethod = 'all',
    minImpuritySplit = 0.0
  } = {}) {
    this.criterion = criterion as any
    this.maxDepth = maxDepth
    this.minSamplesSplit = minSamplesSplit
    this.minSamplesLeaf = minSamplesLeaf
    this.maxFeatures = maxFeatures
    this.maxFeaturesMethod = maxFeaturesMethod as any
    this.minImpuritySplit = minImpuritySplit
    this.tree = new DecisionTree()
  }

  public fit(X: number[][], y: int[], samplesSubset?: number[]) {
    validateY(y)
    validateX(X)

    this.X = X
    this.y = y

    let newSamplesSubset = samplesSubset || []

    // CheckNegativeLabels(yptr);
    this.maxFeatures = SetMaxFeatures(
      this.maxFeatures,
      this.maxFeaturesMethod,
      X
    )

    this.splitter = new Splitter(
      X,
      y,
      this.minSamplesLeaf,
      this.criterion,
      this.maxFeatures,
      newSamplesSubset
    )

    // put root node on stack
    let rootNode: NodeRecord = {
      start: 0,
      end: this.splitter.sampleMap.length,
      depth: 0,
      impurity: 0,
      nSamples: this.splitter.sampleMap.length,
      parentId: -1,
      isLeft: false
    }
    this.stack.push(rootNode)

    let isRootNode = true

    while (this.stack.length !== 0) {
      // take next node from stack
      let currentRecord = this.stack.pop() as NodeRecord
      this.splitter.resetSampleRange(currentRecord.start, currentRecord.end)
      let currentSplit: Split = makeDefaultSplit()

      let isLeaf =
        !(currentRecord.depth < this.maxDepth) ||
        currentRecord.nSamples < this.minSamplesSplit ||
        currentRecord.nSamples < 2 * this.minSamplesLeaf

      // evaluate abort criterion
      if (isRootNode) {
        currentRecord.impurity = this.splitter.criterion.nodeImpurity()
        isRootNode = false
      }

      // or currentRecord.impurity <= 0.0;
      // split unless isLeaf
      if (!isLeaf) {
        currentSplit = this.splitter.splitNode()
        isLeaf =
          isLeaf ||
          !currentSplit.foundSplit ||
          currentRecord.impurity <= this.minImpuritySplit
      }

      let currentNode: Node = {
        parentId: currentRecord.parentId,
        impurity: currentRecord.impurity,
        isLeaf: isLeaf,
        isLeft: currentRecord.isLeft,
        nSamples: currentRecord.nSamples,
        splitFeature: currentSplit.feature,
        threshold: currentSplit.threshold,
        value: this.splitter.criterion.nodeValue().slice(),
        leftChildId: -1,
        rightChildId: -1
      }

      this.tree.nodes.push(currentNode)
      let nodeId = this.tree.nodes.length - 1

      if (!isLeaf) {
        let rightRecord: NodeRecord = {
          start: currentSplit.pos,
          end: currentRecord.end,
          nSamples: currentRecord.end - currentSplit.pos,
          depth: currentRecord.depth + 1,
          parentId: nodeId,
          isLeft: false,
          impurity: currentSplit.impurityRight
        }

        this.stack.push(rightRecord)

        let leftRecord: NodeRecord = {
          start: currentRecord.start,
          end: currentSplit.pos,
          nSamples: currentSplit.pos - currentRecord.start,
          depth: currentRecord.depth + 1,
          parentId: nodeId,
          isLeft: true,
          impurity: currentSplit.impurityLeft
        }

        this.stack.push(leftRecord)
      }
    }
    this.tree.populateChildIds()
    this.tree.isBuilt = true
  }
}

interface DecisionTreeClassifierParams {
  criterion?: 'gini' | 'entropy'
  maxDepth?: int
  minSamplesSplit?: number
  minSamplesLeaf?: number
  maxFeatures?: number
  minImpurityDecrease?: number
}
export class DecisionTreeClassifier extends DecisionTreeBase {
  constructor({
    criterion = 'gini',
    maxDepth = Number.POSITIVE_INFINITY,
    minSamplesSplit = 2,
    minSamplesLeaf = 1,
    maxFeatures = -1,
    minImpurityDecrease = 0.0
  }: DecisionTreeClassifierParams = {}) {
    assert(
      ['gini', 'entropy'].includes(criterion as string),
      'Must pass a criterion that makes sense'
    )
    super({
      criterion,
      maxDepth,
      minSamplesSplit,
      minSamplesLeaf,
      maxFeatures,
      minImpuritySplit: minImpurityDecrease
    })
  }
  public predict(X: number[][]) {
    return this.tree.predictClassification(X)
  }

  public predictProba(X: number[][]) {
    return this.tree.predictProba(X)
  }

  public score(X: number[][], y: number[]): number {
    const yPred = this.predict(X)
    return accuracyScore(y, yPred)
  }
}

interface DecisionTreeRegressorParams {
  criterion?: 'mse'
  maxDepth?: int
  minSamplesSplit?: number
  minSamplesLeaf?: number
  maxFeatures?: number
  minImpurityDecrease?: number
}
export class DecisionTreeRegressor extends DecisionTreeBase {
  constructor({
    criterion = 'mse',
    maxDepth = Number.POSITIVE_INFINITY,
    minSamplesSplit = 2,
    minSamplesLeaf = 1,
    maxFeatures = -1,
    minImpurityDecrease = 0.0
  }: DecisionTreeRegressorParams = {}) {
    assert(
      ['mse'].includes(criterion as string),
      'Must pass a criterion that makes sense'
    )
    super({
      criterion,
      maxDepth,
      minSamplesSplit,
      minSamplesLeaf,
      maxFeatures,
      minImpuritySplit: minImpurityDecrease
    })
  }
  public predict(X: number[][]) {
    return this.tree.predictRegression(X)
  }

  public score(X: number[][], y: number[]): number {
    const yPred = this.predict(X)
    return r2Score(y, yPred)
  }
}
