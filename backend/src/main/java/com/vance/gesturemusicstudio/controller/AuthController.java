package com.vance.gesturemusicstudio.controller;

import com.vance.gesturemusicstudio.dto.auth.AuthResponse;
import com.vance.gesturemusicstudio.dto.auth.LoginRequest;
import com.vance.gesturemusicstudio.dto.auth.RegisterRequest;
import com.vance.gesturemusicstudio.dto.auth.UserResponse;
import com.vance.gesturemusicstudio.service.AuthService;
import com.vance.gesturemusicstudio.service.UserService;
import com.vance.gesturemusicstudio.util.CustomUserDetails;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final UserService userService;

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse register(@Valid @RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/me")
    public UserResponse me(@AuthenticationPrincipal CustomUserDetails userDetails) {
        return UserResponse.from(userDetails.getUser());
    }

    @GetMapping("/check-username")
    public Map<String, Object> checkUsername(@RequestParam String username) {
        boolean taken = userService.existsByUsername(username);
        return Map.of("taken", taken, "message", taken ? "帳號已被使用" : "帳號可以使用");
    }
}
