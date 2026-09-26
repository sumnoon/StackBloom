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
  assert.match(lists.program, /ListNode\* head = stackbloom_list\(\{1, 2, 3\}\);/);
  const physical = lists.program.split('\n');
  assert.equal(physical[lists.firstLine - 2], `#line ${lists.firstLine} "main.cpp"`);
  const trees = buildHarness('class Solution {\npublic:\n    int maxDepth(TreeNode* root) { return 0; }\n};', 'root = [3,9,20,null,null,15,7]');
  assert.match(trees.program, /stackbloom_tree\(\{3, 9, 20, STACKBLOOM_NULL, STACKBLOOM_NULL, 15, 7\}\)/);
  const grid = buildHarness('class Solution {\npublic:\n    void solve(vector<vector<char>>& board) {}\n};', 'board = [["X","O"],["O","X"]]');
  assert.match(grid.program, /vector<vector<char>> board = \{\{'X', 'O'\}, \{'O', 'X'\}\};\n    Solution\(\)\.solve\(board\);\n    stackbloom_print\(board\);/);
  assert.throws(() => buildHarness(twoSum, 'nums = [1,"a"], target = 1'), /nums should be a list of integers, but the test case has "a"/);
  assert.throws(() => buildHarness('class Solution {\npublic:\n    int f(Node* n) { return 0; }\n};', '[]'), /cannot build a Node\*/);
});

test('compiler lines inside the solution map back to the pasted class', () => {
  const harness = {firstLine: 5, lines: 3};
  assert.equal(shiftIssues('main.cpp:6:3: error: x\nmain.cpp:40:1: error: y', harness), 'main.cpp:2:3: error: x\nharness:40:1: error: y');
});
