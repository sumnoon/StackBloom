import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildHarness, findMethod, parseTestcase, shiftIssues} from '../src/leetcode.ts';

const twoSum = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        for (int i = 0; i < (int)nums.size(); ++i) {
            if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};
            seen[nums[i]] = i;
        }
        return {};
    }
};`;

test('the first public method and its parameter types are found', () => {
  const method = findMethod(`class Solution {
    int helper(int x) { return x; }
public:
    // not this: int fake(int y) {}
    bool isValid(const string& s) { if (s.empty()) { return true; } return helper(1); }
};`);
  assert.equal(method.name, 'isValid');
  assert.deepEqual(method.params.map(p => [p.ty.name, p.name, p.output]), [['string', 's', false]]);
  assert.equal(method.returns.kind, 'bool');
});

test('named and line-per-value test cases both work', () => {
  const method = findMethod(twoSum);
  assert.deepEqual(parseTestcase('nums = [2,7,11,15], target = 9', method), [[2, 7, 11, 15], 9]);
  assert.deepEqual(parseTestcase('[3,2,4]\n6\n', method), [[3, 2, 4], 6]);
  assert.throws(() => parseTestcase('[3,2,4]', method), /takes 2 values/);
});

test('the harness keeps the solution at known lines and main in main.cpp', () => {
  const {program, firstLine, lines} = buildHarness(twoSum, 'nums = [2,7,11,15], target = 9');
  const physical = program.split('\n');
  assert.equal(physical[firstLine - 1], 'class Solution {');
  assert.equal(lines, 11);
  const main = physical.indexOf('int main() {');
  assert.equal(physical[main - 1], `#line ${main + 1} "main.cpp"`);
  assert.match(program, /    vector<int> nums = \{2, 7, 11, 15\};\n    int target = 9;\n    auto result = Solution\(\)\.twoSum\(nums, target\);/);
  assert.doesNotMatch(program, /struct ListNode/);
});

test('lists, trees, chars and in-place methods', () => {
  const lists = buildHarness('class Solution {\npublic:\n    ListNode* reverseList(ListNode* head) { return head; }\n};', 'head = [1,2,3]');
  assert.match(lists.program, /#line 1 "stackbloom_harness.h"\nstruct ListNode/);
  assert.match(lists.program, /ListNode\* head = stackbloom_build_ListNode\(\{1, 2, 3\}\);/);
  const physical = lists.program.split('\n');
  assert.equal(physical[lists.firstLine - 2], `#line ${lists.firstLine} "main.cpp"`);
  const trees = buildHarness('class Solution {\npublic:\n    int maxDepth(TreeNode* root) { return 0; }\n};', 'root = [3,9,20,null,null,15,7]');
  assert.match(trees.program, /stackbloom_build_TreeNode\(\{3, 9, 20, nullopt, nullopt, 15, 7\}\)/);
  const grid = buildHarness('class Solution {\npublic:\n    void solve(vector<vector<char>>& board) {}\n};', 'board = [["X","O"],["O","X"]]');
  assert.match(grid.program, /vector<vector<char>> board = \{\{'X', 'O'\}, \{'O', 'X'\}\};\n    Solution\(\)\.solve\(board\);\n    stackbloom_print\(board\);/);
  assert.throws(() => buildHarness(twoSum, 'nums = [1,"a"], target = 1'), /nums should be a list of integers, but the test case has "a"/);
  assert.throws(() => buildHarness('class Solution {\npublic:\n    int f(Node* n) { return 0; }\n};', '[]'), /cannot build a Node\*/);
});

test('compiler lines inside the solution map back to the pasted class', () => {
  const harness = {firstLine: 5, lines: 3};
  assert.equal(shiftIssues('main.cpp:6:3: error: x\nmain.cpp:40:1: error: y', harness), 'main.cpp:2:3: error: x\nharness:40:1: error: y');
});

const preOrder = `#include <iostream>
using namespace std;
struct Node {
    int val;
    Node* left;
    Node* right;
    Node(int val) {
        this->val = val;
        left = right = NULL;
    }
};
void pre_order(Node* root) {
    if (root == NULL) return;
    cout << root->val << endl;
    pre_order(root->left);
    pre_order(root->right);
}`;

test('a plain function with its own tree struct is called like a LeetCode method', () => {
  const method = findMethod(preOrder);
  assert.equal(method.name, 'pre_order');
  assert.equal(method.owner, null);
  assert.deepEqual(method.params[0].ty.node, {name: 'Node', field: 'val', value: {kind: 'int', name: 'int'}, links: ['left', 'right'], construct: 'value'});
  const {program} = buildHarness(preOrder, 'root = [1,2,4,3]');
  assert.match(program, /    Node\* root = stackbloom_build_Node\(\{1, 2, 4, 3\}\);\n    pre_order\(root\);\n    return 0;/);
  assert.match(program, /Node\* node = new Node\(value\);\n    node->left = nullptr;\n    node->right = nullptr;/);
  assert.doesNotMatch(program, /struct TreeNode|#define main/);
});

test('custom list structs, field lists and structs without a constructor', () => {
  const list = buildHarness('struct Item { Item* next; string name; };\nItem* last(Item* head) { while (head && head->next) head = head->next; return head; }', '["a","b"]');
  assert.match(list.program, /Item\* head = stackbloom_build_Item\(\{"a", "b"\}\);/);
  assert.match(list.program, /Item\* node = new Item\(\);\n    node->name = value;\n    node->next = nullptr;/);
  const pair = findMethod('struct T { int key; T *l, *r; };\nint size(T* t) { return t ? 1 + size(t->l) + size(t->r) : 0; }');
  assert.deepEqual(pair.params[0].ty.node.links, ['l', 'r']);
  assert.throws(() => findMethod('struct G { int v; vector<G*> next; };\nint walk(G* g) { return 0; }'), /builds G\* when G has one value field/);
});

test('the entry point is the function nothing else calls, or the one main() calls first', () => {
  const helper = 'int height(Node* n) { return n ? 1 + max(height(n->left), height(n->right)) : 0; }\n'
    + 'bool balanced(Node* n) { return !n || (abs(height(n->left) - height(n->right)) <= 1 && balanced(n->left) && balanced(n->right)); }';
  const tree = 'struct Node { int val; Node *left, *right; Node(int v) : val(v), left(nullptr), right(nullptr) {} };\n';
  assert.equal(findMethod(tree + helper).name, 'balanced');
  const three = tree + 'void a(Node* n) {}\nvoid b(Node* n) {}\nint main() { Node* r = nullptr; b(r); a(r); }';
  assert.equal(findMethod(three).name, 'b');
  assert.throws(() => findMethod('int x = 1;'), /Paste a class Solution, or the function to run/);
});

test('a pasted main() is renamed with the test case, or run as is without one', () => {
  const whole = preOrder + '\nint main() {\n    pre_order(new Node(1));\n    return 0;\n}';
  const harness = buildHarness(whole, 'root = [1]');
  const physical = harness.program.split('\n');
  assert.equal(physical[3], '#define main stackbloom_pasted_main');
  assert.equal(physical[harness.firstLine - 1], '#include <iostream>');
  assert.ok(physical.indexOf('#undef main') < physical.lastIndexOf('int main() {'));
  const own = buildHarness(whole, '  ');
  assert.equal(own.program, whole + '\n');
  assert.equal(own.method, null);
});
