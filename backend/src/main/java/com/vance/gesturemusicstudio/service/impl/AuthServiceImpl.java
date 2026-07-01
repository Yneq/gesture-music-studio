package com.vance.gesturemusicstudio.service.impl;

import com.vance.gesturemusicstudio.dto.auth.AuthResponse;
import com.vance.gesturemusicstudio.dto.auth.LoginRequest;
import com.vance.gesturemusicstudio.dto.auth.RegisterRequest;
import com.vance.gesturemusicstudio.dto.auth.UserResponse;
import com.vance.gesturemusicstudio.exception.ApiException;
import com.vance.gesturemusicstudio.service.AuthService;
import com.vance.gesturemusicstudio.service.UserService;
import com.vance.gesturemusicstudio.util.CustomUserDetails;
import com.vance.gesturemusicstudio.util.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final UserService userService;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    @Override
    public AuthResponse register(RegisterRequest request) {
        var user = userService.register(request);
        var userDetails = new CustomUserDetails(user);
        return AuthResponse.builder()
                .token(jwtService.generateToken(userDetails))
                .user(UserResponse.from(user))
                .build();
    }

    @Override
    public AuthResponse login(LoginRequest request) {
        if (!userService.existsByUsername(request.getUsername())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "帳號不存在");
        }
        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(request.getUsername(), request.getPassword())
            );
            CustomUserDetails userDetails = (CustomUserDetails) authentication.getPrincipal();
            return AuthResponse.builder()
                    .token(jwtService.generateToken(userDetails))
                    .user(UserResponse.from(userDetails.getUser()))
                    .build();
        } catch (BadCredentialsException e) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "密碼錯誤");
        }
    }
}
