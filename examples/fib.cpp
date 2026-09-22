#include <iostream>

int fib(int n) {
    if (n <= 1) return n;
    int left = fib(n - 1);
    int right = fib(n - 2);
    return left + right;
}

int main() {
    int n = 4;
    std::cin >> n;
    int answer = fib(n);
    std::cout << "fib(" << n << ") = " << answer << std::endl;
    return 0;
}
