#include <iostream>

int square(int value) {
    int result = value * value;
    return result;
}

int main() {
    int count = 3;
    std::cin >> count;
    int total = 0;
    for (int i = 1; i <= count; ++i) {
        int term = square(i);
        total += term;
        std::cout << "total=" << total << std::endl;
    }
    return 0;
}
